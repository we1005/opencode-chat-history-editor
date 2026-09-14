import { Router, Request, Response } from 'express';
import { getDb } from '../services/db';
import { EditorError, PartLocation, MessagePart, partEditor, revision } from '../services/partEditor';

const router = Router();

function location(req: Request): PartLocation {
  const { sessionID, messageID, partID } = req.params;
  const row = getDb().prepare(`SELECT s.directory FROM session s
    JOIN message m ON m.session_id = s.id JOIN part p ON p.message_id = m.id AND p.session_id = s.id
    WHERE s.id = ? AND m.id = ? AND p.id = ?`).get(sessionID, messageID, partID) as { directory: string } | undefined;
  if (!row) throw new EditorError(404, '数据库中找不到此消息片段，请刷新会话。');
  return { sessionID, messageID, partID, directory: row.directory };
}

function fail(res: Response, error: unknown) {
  res.status(error instanceof EditorError ? error.status : 500).json({
    success: false, error: error instanceof Error ? error.message : '编辑失败',
  });
}

router.get('/status', async (_req, res) => {
  try { res.json({ success: true, data: await partEditor.status() }); }
  catch (error) { fail(res, error); }
});

const route = '/sessions/:sessionID/messages/:messageID/parts/:partID';

router.get(route, async (req, res) => {
  try {
    const target = location(req);
    const snapshot = await partEditor.get(target);
    res.json({ success: true, data: snapshot });
  } catch (error) { fail(res, error); }
});

router.get(`${route}/history`, (req, res) => {
  try { res.json({ success: true, data: partEditor.history(location(req)) }); }
  catch (error) { fail(res, error); }
});

router.patch(route, async (req, res) => {
  try {
    const target = location(req);
    // The browsing DB and the API must agree before a write (including custom DB_PATH).
    const row = getDb().prepare('SELECT data FROM part WHERE id = ? AND message_id = ? AND session_id = ?')
      .get(target.partID, target.messageID, target.sessionID) as { data: string };
    const local = { ...JSON.parse(row.data), id: target.partID, messageID: target.messageID, sessionID: target.sessionID } as MessagePart;
    if (!req.body || revision(local) !== req.body.revision) {
      throw new EditorError(409, '数据库内容已变化，或 DB_PATH 与 OpenCode API 不是同一份数据。请重新加载并检查配置。');
    }
    const saved = await partEditor.update(target, req.body);
    res.json({ success: true, data: saved });
  } catch (error) { fail(res, error); }
});

export default router;
