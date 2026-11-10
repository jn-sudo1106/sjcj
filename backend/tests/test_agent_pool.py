import copy
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from backend.tests import test_database_generation as fixtures
from backend.runner_management import agent_pool as pool, code_servers, database_generation as tasks, generation_tasks, model_interfaces


class AgentPoolTest(unittest.TestCase):
    setUp = fixtures.DatabaseGenerationTest.setUp
    tearDown = fixtures.DatabaseGenerationTest.tearDown
    request = fixtures.DatabaseGenerationTest.request
    fixture = fixtures.DatabaseGenerationTest.fixture
    start_remote = fixtures.DatabaseGenerationTest.start_remote
    configured = fixtures.DatabaseGenerationTest.configured
    handler = fixtures.DatabaseGenerationTest.handler

    def test_shared_port_is_exclusive_and_release_is_owner_checked(self):
        service, _, body, _ = self.configured()
        agent = next(row for row in model_interfaces.listing(self.app)['items'] if row['id'] == 'workbuddy-agent-hy3')
        chat = {**agent, 'id': 'chat', 'kind': 'chat', 'endpoint': agent['endpoint'].replace('/agent', '/chat')}
        self.assertEqual(pool.resource_key(agent), pool.resource_key(chat))
        with ThreadPoolExecutor(max_workers=2) as executor:
            won = list(executor.map(lambda owner: pool.acquire(self.app, agent, owner), ['one', 'two']))
        self.assertEqual(sum(won), 1)
        owner = 'one' if won[0] else 'two'
        pool.release(self.app, chat, 'other')
        self.assertFalse(pool.acquire(self.app, chat, 'other'))
        self.assertTrue(pool.acquire(self.app, chat, owner, renew=True))
        pool.release(self.app, chat, owner)
        self.assertTrue(pool.acquire(self.app, agent, 'other'))

    def test_all_agents_waits_when_busy_claims_another_port_and_freezes_actual_interface(self):
        service, _, body, calls = self.configured()
        settings = model_interfaces.listing(self.app)
        agent = next(row for row in settings['items'] if row['id'] == 'workbuddy-agent-hy3')
        second = {**copy.deepcopy(agent), 'id': 'second-agent', 'name': '第二智能体', 'isDefault': False, 'cdpPort': agent['cdpPort'] + 1}
        settings['items'].append(second); model_interfaces.save(self.app, settings)
        generation = generation_tasks.read_config(self.app, '101')['generation']
        generation_tasks.save_config(self.app, {'configId': '101', 'generation': {**generation, 'interfaceId': pool.ALL}})
        job = tasks.create(self.app, body)['job']
        server = code_servers.read(self.app, service.identity['serverId'])
        self.assertTrue(pool.acquire(self.app, agent, 'occupied-first'))
        self.assertTrue(pool.acquire(self.app, second, 'occupied-second'))
        self.assertIsNone(tasks.claim(self.app, server)['job'])
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'queued')
        pool.release(self.app, second, 'occupied-second')
        self.assertEqual(tasks.claim(self.app, server)['job']['taskId'], job['taskId'])
        claimed = tasks.read(self.app, job['taskId'])
        self.assertEqual(claimed['input']['interfaceId'], second['id'])
        self.assertEqual(claimed['modelCall']['interfaceId'], second['id'])
        self.assertIsNone(tasks.claim(self.app, server)['job'])
        tasks.execute(self.handler(), self.app, server, job['taskId'])
        self.assertEqual(tasks.read(self.app, job['taskId'])['status'], 'succeeded')
        self.assertEqual(generation_tasks.read_config(self.app, '101')['generation']['interfaceId'], pool.ALL)
        self.assertEqual(next(row for row in model_interfaces.listing(self.app)['items'] if row['id'] == second['id'])['runtimeStatus'], 'idle')
        self.assertEqual(len(calls), 1)

    def test_direct_failure_releases_lease_and_expired_reservation_can_be_reused(self):
        self.configured()
        agent = next(row for row in model_interfaces.listing(self.app)['items'] if row['id'] == 'workbuddy-agent-hy3')
        with patch.object(model_interfaces, '_generate_reserved', side_effect=RuntimeError('model failed')):
            with self.assertRaisesRegex(RuntimeError, 'model failed'):
                model_interfaces.generate(self.app, {'interfaceId': agent['id']})
        self.assertTrue(pool.acquire(self.app, agent, 'expired', ttl=-1))
        self.assertTrue(pool.acquire(self.app, agent, 'new'))
        pool.release(self.app, agent, 'expired')
        self.assertFalse(pool.acquire(self.app, agent, 'blocked'))
