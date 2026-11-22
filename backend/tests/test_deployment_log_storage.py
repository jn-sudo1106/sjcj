import json
import unittest
from backend.tests import test_delivery_task_merge as fixtures
from backend.runner_management import deployment_log_storage as storage, delivery_tasks, log_records
from backend.runner_management.deployment_history import record
from backend.runner_management.runtime_history import add_event
from backend.runner_management.store import Store


class DeploymentLogStorageTest(unittest.TestCase):
    setUp = fixtures.DeliveryTaskMergeTest.setUp
    record = fixtures.DeliveryTaskMergeTest.record

    def test_old_event_arrays_move_losslessly_and_migration_is_idempotent(self):
        events = [{'eventId':'1'*32,'time':'2026-11-21T00:00:00+00:00','stage':'created','message':'创建任务','detail':'','level':'info'},
                  {'eventId':'2'*32,'time':'2026-11-21T00:00:01+00:00','stage':'failed','message':'拒绝访问','detail':'文件占用','level':'error'}]
        with self.store.connect() as db:
            original = json.loads(db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id='parent-one'").fetchone()[0])
            db.execute("UPDATE jobs SET payload=? WHERE job_type='deployment' AND job_id='parent-one'",(json.dumps({**original,'executionEvents':events}),))
        for _ in range(2):
            self.store = Store(self.path)
            with self.store.connect() as db:
                self.assertEqual(json.loads(db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id='parent-one'").fetchone()[0]),original)
                rows = db.execute("SELECT * FROM logs WHERE task_type='deployment' AND task_id='parent-one' ORDER BY seq").fetchall()
                self.assertEqual([row['log_id'] for row in rows],[event['eventId'] for event in events])
                self.assertEqual([row['status'] for row in rows],['queued','failed'])
                for row,event in zip(rows,events):
                    detail=json.loads(row['payload'])
                    self.assertEqual((row['occurred_at'],row['message'],detail['stage'],detail['level'],detail['detail']),
                                     (event['time'],event['message'],event['stage'],event['level'],event['detail']))
                self.assertEqual(list(db.execute('PRAGMA foreign_key_check')),[])

    def test_new_stage_buffer_is_not_part_of_task_parameters_and_repeated_wait_is_deduplicated(self):
        job={'jobId':'parent-one','status':'waiting_resource','deliveryId':''}
        with self.store.connect() as db:
            record(job,'waiting_resource','等待 Runner')
            storage.flush(db,job)
            storage.flush(db,job)
            second={'jobId':'parent-one','status':'waiting_resource','deliveryId':''}
            record(second,'waiting_resource','等待 Runner')
            storage.flush(db,second)
            self.assertNotIn('executionEvents',storage.payload(job))
            self.assertEqual(db.execute("SELECT COUNT(*) FROM logs WHERE task_type='deployment' AND task_id='parent-one'").fetchone()[0],1)

    def test_runner_events_for_two_machines_and_late_retry_stay_with_the_executing_task(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO runners(runner_id,name,ip_address,install_directory,platform,capabilities,token_hash,status) VALUES('second','second','other-ip','root','any','[]','other-hash','online')")
            first=delivery_tasks.create(db,self.record('a'*32))
            second=delivery_tasks.create(db,self.record('b'*32,runner_id='second'))
            add_event(db,'a'*32,'download','第一台下载',event_id='c'*32)
            add_event(db,'b'*32,'verify','第二台校验',event_id='d'*32)
            for event,job in (('c'*32,first),('d'*32,second)):
                row=db.execute("SELECT task_type,task_id,status FROM logs WHERE log_id=?",(event,)).fetchone()
                self.assertEqual(tuple(row),('deployment',job['jobId'],'running'))
            delivery_tasks.update(db,'a'*32,status='failed',expected_status='pending',finished_at='finish',error='旧错误')
            first=json.loads(db.execute("SELECT payload FROM jobs WHERE job_type='deployment' AND job_id=?",(first['jobId'],)).fetchone()[0])
            delivery_tasks.retry(db,first)
            db.execute("DELETE FROM logs WHERE log_type='event' AND record_id=?",('a'*32,))
            add_event(db,'a'*32,'failed','重试后补到的旧日志',event_id='e'*32)
            row=db.execute("SELECT task_id FROM logs WHERE log_id=?",('e'*32,)).fetchone()
            self.assertEqual(row['task_id'],first['jobId'])
            records,_=storage.events(db,second)
            self.assertNotIn('e'*32,{event['eventId'] for event in records})


if __name__=='__main__':unittest.main()
