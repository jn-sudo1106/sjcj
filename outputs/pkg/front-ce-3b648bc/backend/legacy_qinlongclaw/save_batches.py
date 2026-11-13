"""Shared bounded saver batches and terminal timeout feedback."""
import json
import logging


class SaveTimeoutError(RuntimeError):
    pass


def save_in_batches(save_batch, task, datas, batch_size=50):
    result = None
    for offset in range(0, len(datas), batch_size):
        batch = datas[offset:offset + batch_size]
        logging.info('[SaveBatch] 保存第 %s-%s/%s 条', offset + 1, offset + len(batch), len(datas))
        try:
            result = save_batch(task, batch)
        except SaveTimeoutError as exc:
            raise SaveTimeoutError(
                f'保存第 {offset + 1}-{offset + len(batch)}/{len(datas)} 条超时；'
                f'此前 {offset} 条已返回成功，当前批结果未知，后续批未提交。{exc}'
            ) from exc
        if result is None:
            raise RuntimeError(f'第 {offset + 1}-{offset + len(batch)} 条保存失败，停止后续批次')
    return result


def finish_failure(channel, method, task, error, saver=None, mark='任务处理失败'):
    from queue_url_history import record_task_result
    task = task if isinstance(task, dict) else {}
    reason = str(error) or mark
    context = task.get('Context') or {}
    if isinstance(context, str):
        try:
            context = json.loads(context)
        except ValueError:
            context = {}
    url = (context.get('url') if isinstance(context, dict) else '') or task.get('Url') or '-'
    if saver is not None:
        try:
            if saver(task, [{'9002': url, '52000380': reason}]) is None:
                raise RuntimeError('保存接口未返回成功结果')
        except Exception as exc:
            logging.exception('52000380 回写失败，原失败原因: %s', reason)
            reason += f'; 52000380回写失败: {exc}'
    record_task_result(False, reason)
    logging.error('[TaskFailed] %s；完成当前 MQ 消息，不重新入队', reason)
    message = {'IsSuccess': 'false', 'StrTaskId': str(task.get('TaskID') or ''),
               'ErrorMessage': reason, 'Mark': mark}
    try:
        channel.basic_publish(exchange='', routing_key='biz_msg_ret',
                              body=json.dumps(message, ensure_ascii=False))
    except Exception:
        logging.exception('保存超时反馈发送失败，仍尝试确认原消息')
    channel.basic_ack(delivery_tag=method.delivery_tag)


def finish_save_timeout(channel, method, task, error, saver=None):
    finish_failure(channel, method, task, error, saver, mark='保存超时')
