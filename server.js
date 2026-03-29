const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const archiver = require('archiver');
const QRCode = require('qrcode');
const Busboy = require('busboy');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const ROOM_STATE_FILE = path.join(DATA_DIR, 'rooms.json');
const MAX_ROOM_MEMBERS = 10;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024 * 1024;
const MAX_MESSAGES = 120;
const PENDING_MEMBER_TTL_MS = 3 * 60 * 1000;
const MAX_INACTIVE_MINUTES = 7 * 24 * 60;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = new Map();
const sessions = new Map();
let persistChain = Promise.resolve();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('hex');
}

function randomRoomCode(length = 6) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  while (code.length < length) {
    const bytes = crypto.randomBytes(length);
    for (const byte of bytes) {
      code += alphabet[byte % alphabet.length];
      if (code.length === length) {
        break;
      }
    }
  }
  return code;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(room, password) {
  const computed = crypto.scryptSync(password, room.passwordSalt, 64).toString('hex');
  const left = Buffer.from(computed, 'hex');
  const right = Buffer.from(room.passwordHash, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sanitizeSegment(segment) {
  let value = String(segment ?? '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!value) {
    value = 'untitled';
  }

  if (value === '.' || value === '..') {
    value = 'untitled';
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(value)) {
    value = `_${value}`;
  }

  return value.slice(0, 120);
}

function normalizeRelativePath(input) {
  const segments = String(input ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map(sanitizeSegment);

  return segments.length ? segments : ['untitled'];
}

function getFolderRoot(relativePath) {
  const segments = normalizeRelativePath(relativePath);
  return segments.length > 1 ? segments[0] : null;
}

function resolveStoragePath(storagePath) {
  const segments = String(storagePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);

  return path.join(UPLOADS_DIR, ...segments);
}

function touchRoomActivity(room) {
  room.lastActivityAt = new Date().toISOString();
}

function getRoomArchiveName(room) {
  return `${sanitizeSegment(room.name || room.id)}-room.zip`;
}

function buildInviteUrl(req, room) {
  const protocol = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim() || 'http';
  const host = req.get('host');
  const url = new URL(`${protocol}://${host}/`);
  url.searchParams.set('room', room.id);
  return url.toString();
}

function getArchiveEntries(files) {
  return files
    .filter((file) => file?.path && fs.existsSync(file.path))
    .map((file) => ({
      path: file.path,
      name: file.relativePath || file.name || path.basename(file.path)
    }));
}

function sendZipArchive(res, archiveName, entries) {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${archiveName}"`);

  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (error) => {
    if (!res.headersSent) {
      res.status(500).json({ error: error.message || 'Unable to create the zip archive.' });
    } else {
      res.destroy(error);
    }
  });

  res.on('close', () => {
    if (!res.writableEnded) {
      archive.abort();
    }
  });

  archive.pipe(res);
  for (const entry of entries) {
    archive.file(entry.path, { name: entry.name });
  }
  archive.finalize();
}

function removeRoomStorage(roomId) {
  fs.rmSync(resolveStoragePath(roomId), { recursive: true, force: true });
}

function purgeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) {
    return null;
  }

  for (const [token, session] of sessions.entries()) {
    if (session.roomId === roomId) {
      sessions.delete(token);
    }
  }

  removeRoomStorage(roomId);
  rooms.delete(roomId);
  return room;
}

function readOptionalInt(value, fieldName, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  if (!/^\d+$/.test(text)) {
    throw httpError(400, `${fieldName} must be a whole number.`);
  }

  const number = Number(text);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw httpError(400, `${fieldName} must be between ${min} and ${max}.`);
  }

  return number;
}

function expireInactiveRooms() {
  const now = Date.now();
  let changed = false;

  for (const room of [...rooms.values()]) {
    const timeoutMinutes = Number(room.inactiveExpiresAfterMinutes) || 0;
    if (!timeoutMinutes) {
      continue;
    }

    if (getActiveMembers(room).length) {
      continue;
    }

    const lastActivity = new Date(room.lastActivityAt || room.createdAt || Date.now()).getTime();
    if (!Number.isFinite(lastActivity)) {
      continue;
    }

    if (now - lastActivity >= timeoutMinutes * 60 * 1000) {
      purgeRoom(room.id);
      changed = true;
      console.log(`Room ${room.id} expired after ${timeoutMinutes} minute(s) of inactivity.`);
    }
  }

  if (changed) {
    schedulePersist();
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const decimals = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}

function loadPersistedState() {
  if (!fs.existsSync(ROOM_STATE_FILE)) {
    return;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(ROOM_STATE_FILE, 'utf8'));
    const items = Array.isArray(raw.rooms) ? raw.rooms : [];

    for (const entry of items) {
      if (!entry?.id || !entry?.name || !entry?.passwordSalt || !entry?.passwordHash) {
        continue;
      }

      const room = {
        id: String(entry.id).toUpperCase(),
        name: String(entry.name),
        hostName: null,
        hostMemberId: null,
        createdAt: entry.createdAt || new Date().toISOString(),
        lastActivityAt: entry.lastActivityAt || entry.createdAt || new Date().toISOString(),
        inactiveExpiresAfterMinutes: Number(entry.inactiveExpiresAfterMinutes) || 0,
        passwordSalt: String(entry.passwordSalt),
        passwordHash: String(entry.passwordHash),
        storageBytes: Number(entry.storageBytes) || 0,
        messages: Array.isArray(entry.messages) ? entry.messages.filter((message) => message && typeof message === 'object').slice(-MAX_MESSAGES) : [],
        files: [],
        members: new Map()
      };

      for (const file of Array.isArray(entry.files) ? entry.files : []) {
        const relativePath = String(file?.relativePath || file?.name || '').trim();
        const storagePath = String(file?.storagePath || '').trim();
        const resolvedPath = storagePath ? resolveStoragePath(storagePath) : String(file?.path || '').trim();
        if (!resolvedPath || !fs.existsSync(resolvedPath)) {
          continue;
        }

        room.files.push({
          id: String(file.id || crypto.randomUUID()),
          name: String(file.name || path.basename(relativePath || resolvedPath)),
          relativePath: relativePath || path.basename(resolvedPath),
          folderRoot: file.folderRoot || getFolderRoot(relativePath),
          size: Number(file.size) || 0,
          uploadedBy: String(file.uploadedBy || 'Unknown'),
          uploadedById: file.uploadedById ? String(file.uploadedById) : null,
          uploadedAt: file.uploadedAt || new Date().toISOString(),
          mimeType: String(file.mimeType || 'application/octet-stream'),
          storagePath: storagePath || path.relative(UPLOADS_DIR, resolvedPath).split(path.sep).join('/'),
          path: resolvedPath
        });
      }

      room.storageBytes = room.files.reduce((total, file) => total + (Number(file.size) || 0), 0);

      if (!room.messages.length) {
        room.messages.push(systemMessage(`Room "${room.name}" is ready. Share the code and password to invite others.`));
      }

      rooms.set(room.id, room);
    }
  } catch (error) {
    console.error('Failed to load persisted rooms:', error);
  }
}

function serializeState() {
  return {
    rooms: [...rooms.values()].map((room) => ({
      id: room.id,
      name: room.name,
      hostName: room.hostName,
      createdAt: room.createdAt,
      lastActivityAt: room.lastActivityAt,
      inactiveExpiresAfterMinutes: Number(room.inactiveExpiresAfterMinutes) || 0,
      passwordSalt: room.passwordSalt,
      passwordHash: room.passwordHash,
      storageBytes: room.storageBytes,
      messages: room.messages,
      files: room.files.map((file) => ({
        id: file.id,
        name: file.name,
        relativePath: file.relativePath,
        folderRoot: file.folderRoot,
        size: file.size,
        uploadedBy: file.uploadedBy,
        uploadedById: file.uploadedById,
        uploadedAt: file.uploadedAt,
        mimeType: file.mimeType,
        storagePath: file.storagePath,
        path: file.path
      }))
    }))
  };
}

function schedulePersist() {
  persistChain = persistChain
    .then(async () => {
      const payload = JSON.stringify(serializeState(), null, 2);
      await fsp.writeFile(ROOM_STATE_FILE, payload, 'utf8');
    })
    .catch((error) => {
      console.error('Failed to persist rooms:', error);
    });

  return persistChain;
}

loadPersistedState();

function trimArray(array, limit) {
  if (array.length > limit) {
    array.splice(0, array.length - limit);
  }
}

function systemMessage(text) {
  return {
    id: crypto.randomUUID(),
    kind: 'system',
    text,
    createdAt: new Date().toISOString()
  };
}

function userMessage(member, text) {
  return {
    id: crypto.randomUUID(),
    kind: 'user',
    authorId: member.id,
    authorName: member.name,
    text,
    createdAt: new Date().toISOString()
  };
}

function getActiveMembers(room) {
  return [...room.members.values()].filter((member) => member.socketId);
}

function roomSnapshot(room) {
  const members = getActiveMembers(room)
    .map((member) => ({
      id: member.id,
      name: member.name,
      socketId: member.socketId,
      joinedAt: member.joinedAt,
      isHost: room.hostMemberId === member.id
    }))
    .sort((a, b) => {
      if (a.isHost !== b.isHost) {
        return a.isHost ? -1 : 1;
      }
      return new Date(a.joinedAt) - new Date(b.joinedAt);
    });

  const files = [...room.files]
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
    .map((file) => ({
      id: file.id,
      name: file.name,
      relativePath: file.relativePath,
      folderRoot: file.folderRoot,
      size: file.size,
      uploadedBy: file.uploadedBy,
      uploadedById: file.uploadedById,
      uploadedAt: file.uploadedAt,
      mimeType: file.mimeType
    }));

  return {
    id: room.id,
    name: room.name,
    hostName: room.hostName,
    createdAt: room.createdAt,
    lastActivityAt: room.lastActivityAt,
    inactiveExpiresAfterMinutes: Number(room.inactiveExpiresAfterMinutes) || 0,
    memberCount: members.length,
    memberLimit: MAX_ROOM_MEMBERS,
    storageBytes: room.storageBytes,
    uploadLimitBytes: MAX_UPLOAD_BYTES,
    members,
    files,
    messages: room.messages.slice(-MAX_MESSAGES)
  };
}

function broadcastRoomState(room) {
  io.to(room.id).emit('room:state', roomSnapshot(room));
}

function createRoom({ roomName, hostName, password }) {
  let roomId = randomRoomCode();
  while (rooms.has(roomId)) {
    roomId = randomRoomCode();
  }

  const room = {
    id: roomId,
    name: roomName,
    hostName,
    hostMemberId: null,
    createdAt: new Date().toISOString(),
    lastActivityAt: new Date().toISOString(),
    inactiveExpiresAfterMinutes: 0,
    passwordSalt: '',
    passwordHash: '',
    storageBytes: 0,
    messages: [systemMessage(`Room "${roomName}" is ready. Share the code and password to invite others.`)],
    files: [],
    members: new Map()
  };

  const { salt, hash } = hashPassword(password);
  room.passwordSalt = salt;
  room.passwordHash = hash;

  const member = {
    id: crypto.randomUUID(),
    name: hostName,
    token: randomToken(),
    socketId: null,
    joinedAt: new Date().toISOString()
  };

  room.members.set(member.id, member);
  room.hostMemberId = member.id;

  rooms.set(roomId, room);
  sessions.set(member.token, { roomId, memberId: member.id });
  touchRoomActivity(room);
  schedulePersist();

  return { room, member };
}

function addPendingMember(room, name) {
  if (room.members.size >= MAX_ROOM_MEMBERS) {
    throw httpError(409, 'This room already has 10 people in line or connected.');
  }

  const member = {
    id: crypto.randomUUID(),
    name,
    token: randomToken(),
    socketId: null,
    joinedAt: new Date().toISOString()
  };

  room.members.set(member.id, member);
  sessions.set(member.token, { roomId: room.id, memberId: member.id });

  if (!room.hostMemberId) {
    room.hostMemberId = member.id;
    room.hostName = member.name;
  }

  touchRoomActivity(room);
  schedulePersist();

  return member;
}

function removeMember(room, memberId, { announce = true } = {}) {
  const member = room.members.get(memberId);
  if (!member) {
    return null;
  }

  const wasActive = Boolean(member.socketId);
  const wasHost = room.hostMemberId === memberId;

  room.members.delete(memberId);
  sessions.delete(member.token);

  if (wasHost) {
    const nextHost = getActiveMembers(room)[0] || null;
    room.hostMemberId = nextHost ? nextHost.id : null;
    room.hostName = nextHost ? nextHost.name : null;
  }

  if (announce && wasActive) {
    room.messages.push(systemMessage(`${member.name} left the room.`));
    trimArray(room.messages, MAX_MESSAGES);
  }

  if (wasHost && !room.hostMemberId && getActiveMembers(room).length === 0) {
    room.hostName = null;
  }

  touchRoomActivity(room);
  schedulePersist();

  return member;
}

function requireJsonString(value, fieldName, { min = 1, max = 64 } = {}) {
  const text = String(value ?? '').trim();
  if (text.length < min) {
    throw httpError(400, `${fieldName} is required.`);
  }
  if (text.length > max) {
    throw httpError(400, `${fieldName} must be ${max} characters or fewer.`);
  }
  return text;
}

function ensureSessionFromRequest(req) {
  const token = String(req.query.token || req.headers['x-room-token'] || '').trim();
  if (!token) {
    throw httpError(401, 'Missing room token.');
  }

  const session = sessions.get(token);
  if (!session) {
    throw httpError(401, 'Your session expired. Please join the room again.');
  }

  const room = rooms.get(session.roomId);
  if (!room) {
    throw httpError(404, 'Room not found.');
  }

  const member = room.members.get(session.memberId);
  if (!member) {
    throw httpError(401, 'Your seat is no longer active. Please join the room again.');
  }

  return { token, session, room, member };
}

function ensureLiveRoomMember(req, roomId) {
  const context = ensureSessionFromRequest(req);
  if (context.room.id !== roomId) {
    throw httpError(404, 'Room not found.');
  }
  if (!context.member.socketId) {
    throw httpError(401, 'You need to be connected to use this action.');
  }

  return context;
}

function ensureRoomHost(req, roomId) {
  const context = ensureLiveRoomMember(req, roomId);
  if (context.room.hostMemberId !== context.member.id) {
    throw httpError(403, 'Only the host can do that.');
  }

  return context;
}

function getRoomFile(room, fileId) {
  return room.files.find((entry) => entry.id === fileId) || null;
}

function getFileStorageRoot(roomId, fileId) {
  return resolveStoragePath(path.posix.join(roomId, fileId));
}

function removeFileStorage(roomId, fileId) {
  fs.rmSync(getFileStorageRoot(roomId, fileId), { recursive: true, force: true });
}

function removeRoomFile(room, fileId) {
  const index = room.files.findIndex((entry) => entry.id === fileId);
  if (index < 0) {
    return null;
  }

  const [file] = room.files.splice(index, 1);
  room.storageBytes = Math.max(0, room.storageBytes - (Number(file.size) || 0));
  return file;
}

function getFilesForFolder(room, folderRoot) {
  const safeRoot = sanitizeSegment(folderRoot);
  return room.files.filter((file) => file.folderRoot === safeRoot);
}

app.post('/api/rooms', (req, res) => {
  try {
    const roomName = requireJsonString(req.body.roomName, 'Room name', { min: 2, max: 48 });
    const hostName = requireJsonString(req.body.hostName, 'Your name', { min: 1, max: 32 });
    const password = requireJsonString(req.body.password, 'Password', { min: 4, max: 128 });
    const { room, member } = createRoom({ roomName, hostName, password });

    res.status(201).json({
      room: roomSnapshot(room),
      session: {
        token: member.token,
        memberId: member.id
      },
      member: {
        id: member.id,
        name: member.name,
        isHost: true
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to create the room.' });
  }
});

app.post('/api/rooms/:roomId/join', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const room = rooms.get(roomId);

    if (!room) {
      throw httpError(404, 'No room with that code exists.');
    }

    const name = requireJsonString(req.body.name, 'Your name', { min: 1, max: 32 });
    const password = requireJsonString(req.body.password, 'Password', { min: 1, max: 128 });

    if (!verifyPassword(room, password)) {
      throw httpError(401, 'That password is not correct.');
    }

    const member = addPendingMember(room, name);

    res.status(201).json({
      room: roomSnapshot(room),
      session: {
        token: member.token,
        memberId: member.id
      },
      member: {
        id: member.id,
        name: member.name,
        isHost: room.hostMemberId === member.id
      }
    });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to join the room.' });
  }
});

app.get('/api/rooms/:roomId/files/:fileId', (req, res) => {
  try {
    const { room, member } = ensureSessionFromRequest(req);
    if (room.id !== String(req.params.roomId || '').trim().toUpperCase()) {
      throw httpError(404, 'Room not found.');
    }
    if (!member.socketId) {
      throw httpError(401, 'You need to be connected to download files.');
    }

    const file = room.files.find((entry) => entry.id === req.params.fileId);
    if (!file) {
      throw httpError(404, 'File not found.');
    }

    res.download(file.path, file.name);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to download the file.' });
  }
});

app.get('/api/rooms/:roomId/files/:fileId/preview', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureLiveRoomMember(req, roomId);
    const file = getRoomFile(room, req.params.fileId);

    if (!file || !file.path || !fs.existsSync(file.path)) {
      throw httpError(404, 'File not found.');
    }

    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${sanitizeSegment(file.name || 'preview')}"`);

    const stream = fs.createReadStream(file.path);
    stream.on('error', (error) => {
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Unable to preview the file.' });
      } else {
        res.destroy(error);
      }
    });
    res.on('close', () => {
      stream.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to preview the file.' });
  }
});

app.get('/api/rooms/:roomId/folders/:folderRoot/zip', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureLiveRoomMember(req, roomId);
    const folderRoot = sanitizeSegment(req.params.folderRoot || '');
    const entries = getArchiveEntries(getFilesForFolder(room, folderRoot));

    if (!entries.length) {
      throw httpError(404, 'That folder is empty or no longer exists.');
    }

    sendZipArchive(res, `${folderRoot}.zip`, entries);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to download the folder.' });
  }
});

app.get('/api/rooms/:roomId/zip', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureLiveRoomMember(req, roomId);
    const entries = getArchiveEntries(room.files);

    if (!entries.length) {
      throw httpError(404, 'That room has no files yet.');
    }

    sendZipArchive(res, getRoomArchiveName(room), entries);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to download the room zip.' });
  }
});

app.get('/api/rooms/:roomId/invite-qr', async (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureLiveRoomMember(req, roomId);
    const inviteUrl = buildInviteUrl(req, room);
    const svg = await QRCode.toString(inviteUrl, {
      type: 'svg',
      margin: 1,
      width: 256,
      errorCorrectionLevel: 'M'
    });

    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(svg);
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to generate the invite QR.' });
  }
});

app.delete('/api/rooms/:roomId/files/:fileId', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureRoomHost(req, roomId);
    const file = getRoomFile(room, req.params.fileId);
    if (!file) {
      throw httpError(404, 'File not found.');
    }

    removeFileStorage(room.id, file.id);
    removeRoomFile(room, file.id);
    room.messages.push(systemMessage(`The host deleted ${file.relativePath}.`));
    trimArray(room.messages, MAX_MESSAGES);
    touchRoomActivity(room);
    broadcastRoomState(room);
    schedulePersist();

    res.json({ ok: true, room: roomSnapshot(room) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to delete the file.' });
  }
});

app.delete('/api/rooms/:roomId/folders/:folderRoot', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room } = ensureRoomHost(req, roomId);
    const folderRoot = sanitizeSegment(req.params.folderRoot || '');
    const folderFiles = getFilesForFolder(room, folderRoot);

    if (!folderFiles.length) {
      throw httpError(404, 'That folder was not found.');
    }

    for (const file of folderFiles) {
      removeFileStorage(room.id, file.id);
      removeRoomFile(room, file.id);
    }

    room.messages.push(systemMessage(`The host deleted the folder "${folderRoot}".`));
    trimArray(room.messages, MAX_MESSAGES);
    touchRoomActivity(room);
    broadcastRoomState(room);
    schedulePersist();

    res.json({ ok: true, room: roomSnapshot(room) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to delete the folder.' });
  }
});

app.post('/api/rooms/:roomId/settings', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room, member } = ensureRoomHost(req, roomId);

    const nextNameRaw = String(req.body.roomName ?? '').trim();
    const nextPasswordRaw = String(req.body.password ?? '').trim();
    const nextInactiveMinutes = readOptionalInt(req.body.inactiveMinutes, 'Idle timeout', {
      min: 0,
      max: MAX_INACTIVE_MINUTES
    });

    let changed = false;

    if (nextNameRaw && nextNameRaw !== room.name) {
      room.name = requireJsonString(nextNameRaw, 'Room name', { min: 2, max: 48 });
      changed = true;
    }

    if (nextPasswordRaw && !verifyPassword(room, nextPasswordRaw)) {
      const { salt, hash } = hashPassword(nextPasswordRaw);
      room.passwordSalt = salt;
      room.passwordHash = hash;
      changed = true;
    }

    if (nextInactiveMinutes !== null && nextInactiveMinutes !== room.inactiveExpiresAfterMinutes) {
      room.inactiveExpiresAfterMinutes = nextInactiveMinutes;
      changed = true;
    }

    if (changed) {
      touchRoomActivity(room);
      room.messages.push(systemMessage(`${member.name} updated the room settings.`));
      trimArray(room.messages, MAX_MESSAGES);
      broadcastRoomState(room);
      schedulePersist();
    }

    res.json({ ok: true, room: roomSnapshot(room) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to update room settings.' });
  }
});

app.post('/api/rooms/:roomId/upload', async (req, res) => {
  const roomId = String(req.params.roomId || '').trim().toUpperCase();
  const room = rooms.get(roomId);

  if (!room) {
    return res.status(404).json({ error: 'Room not found.' });
  }

  let filePromise = null;
  let finalPath = null;

  try {
    await new Promise((resolve, reject) => {
      const busboy = Busboy({
        headers: req.headers,
        limits: {
          files: 1,
          fileSize: MAX_UPLOAD_BYTES
        }
      });

      const fields = {};

      const abortWith = (status, message) => {
        reject(httpError(status, message));
      };

      req.on('aborted', () => {
        abortWith(499, 'Upload cancelled by the browser.');
      });

      busboy.on('field', (name, value) => {
        fields[name] = value;
      });

      busboy.on('file', (fieldName, fileStream, info) => {
        if (fieldName !== 'file') {
          fileStream.resume();
          return;
        }

        filePromise = (async () => {
          try {
          const token = requireJsonString(fields.token, 'Session token', { min: 1, max: 256 });
          const session = sessions.get(token);

          if (!session || session.roomId !== room.id) {
            throw httpError(401, 'Your session expired. Please join the room again.');
          }

          const member = room.members.get(session.memberId);
          if (!member || !member.socketId) {
            throw httpError(401, 'You must be connected to upload files.');
          }

          const relativePath = requireJsonString(fields.relativePath || info.filename || 'upload', 'File name', {
            min: 1,
            max: 512
          });
          const fileId = crypto.randomUUID();
          const safeSegments = normalizeRelativePath(relativePath);
          const storagePath = path.posix.join(room.id, fileId, ...safeSegments);
          finalPath = resolveStoragePath(storagePath);
          await fsp.mkdir(path.dirname(finalPath), { recursive: true });

          let written = 0;
          let settled = false;

          const result = await new Promise((resolveFile, rejectFile) => {
            const out = fs.createWriteStream(finalPath, { mode: 0o640 });

            const fail = (error) => {
              if (settled) {
                return;
              }
              settled = true;
              fileStream.unpipe(out);
              out.destroy();
              rejectFile(error);
            };

            fileStream.on('data', (chunk) => {
              written += chunk.length;
            });

            fileStream.on('limit', () => {
              fail(httpError(413, 'This upload is larger than 100 GB, which is the app limit for a single file.'));
            });

            fileStream.on('error', fail);
            out.on('error', fail);
            out.on('close', () => {
              if (settled) {
                return;
              }
              settled = true;
              resolveFile();
            });

            fileStream.pipe(out);
          });

          return {
            id: fileId,
            name: path.basename(finalPath),
            relativePath: safeSegments.join('/'),
            folderRoot: getFolderRoot(safeSegments.join('/')),
            size: written,
            uploadedBy: member.name,
            uploadedById: member.id,
            uploadedAt: new Date().toISOString(),
            mimeType: info.mimeType || 'application/octet-stream',
            storagePath,
            path: finalPath
          };
          } catch (error) {
            fileStream.resume();
            throw error;
          }
        })();
        filePromise.catch(() => {});
      });

      busboy.on('finish', resolve);
      busboy.on('error', reject);

      req.pipe(busboy);
    });

    if (!filePromise) {
      throw httpError(400, 'Please choose a file to upload.');
    }

    const uploadedFile = await filePromise;
    room.storageBytes += uploadedFile.size;
    room.files.unshift(uploadedFile);

    touchRoomActivity(room);
    schedulePersist();
    broadcastRoomState(room);

    res.status(201).json({
      file: {
        id: uploadedFile.id,
        name: uploadedFile.name,
        relativePath: uploadedFile.relativePath,
        size: uploadedFile.size,
        uploadedBy: uploadedFile.uploadedBy,
        uploadedById: uploadedFile.uploadedById,
        uploadedAt: uploadedFile.uploadedAt,
        mimeType: uploadedFile.mimeType
      },
      room: roomSnapshot(room)
    });
  } catch (error) {
    if (finalPath) {
      await fsp.rm(finalPath, { recursive: true, force: true }).catch(() => {});
    }
    res.status(error.status || 500).json({ error: error.message || 'Unable to upload the file.' });
  }
});

app.post('/api/rooms/:roomId/host/transfer', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room, member } = ensureRoomHost(req, roomId);
    const targetMemberId = String(req.body.memberId || '').trim();

    if (!targetMemberId) {
      throw httpError(400, 'Choose a member to transfer host to.');
    }

    const target = room.members.get(targetMemberId);
    if (!target || !target.socketId) {
      throw httpError(404, 'That member is not connected.');
    }
    if (target.id === member.id) {
      throw httpError(400, 'You are already the host.');
    }

    room.hostMemberId = target.id;
    room.hostName = target.name;
    room.messages.push(systemMessage(`${member.name} transferred host control to ${target.name}.`));
    trimArray(room.messages, MAX_MESSAGES);
    touchRoomActivity(room);
    broadcastRoomState(room);
    schedulePersist();

    res.json({ ok: true, room: roomSnapshot(room) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to transfer host.' });
  }
});

app.post('/api/rooms/:roomId/members/:memberId/kick', (req, res) => {
  try {
    const roomId = String(req.params.roomId || '').trim().toUpperCase();
    const { room, member } = ensureRoomHost(req, roomId);
    const target = room.members.get(String(req.params.memberId || '').trim());

    if (!target) {
      throw httpError(404, 'Member not found.');
    }
    if (target.id === member.id) {
      throw httpError(400, 'Leave the room instead of kicking yourself.');
    }
    if (target.id === room.hostMemberId) {
      throw httpError(403, 'You cannot kick the host.');
    }

    const targetSocketId = target.socketId;
    removeMember(room, target.id, { announce: false });

    room.messages.push(systemMessage(`${target.name} was removed by the host.`));
    trimArray(room.messages, MAX_MESSAGES);
    touchRoomActivity(room);
    schedulePersist();
    broadcastRoomState(room);

    if (targetSocketId) {
      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('room:kicked', {
          message: 'You were removed from the room by the host.'
        });
        targetSocket.disconnect(true);
      }
    }

    res.json({ ok: true, room: roomSnapshot(room) });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to kick the member.' });
  }
});

io.use((socket, next) => {
  try {
    const token = String(socket.handshake.auth?.token || '').trim();
    if (!token) {
      throw httpError(401, 'Missing room token.');
    }

    const session = sessions.get(token);
    if (!session) {
      throw httpError(401, 'Your session expired. Please join the room again.');
    }

    const room = rooms.get(session.roomId);
    if (!room) {
      throw httpError(404, 'Room not found.');
    }

    const member = room.members.get(session.memberId);
    if (!member) {
      throw httpError(401, 'Your seat is no longer active. Please join the room again.');
    }

    socket.data.roomId = room.id;
    socket.data.memberId = member.id;
    next();
  } catch (error) {
    next(error);
  }
});

io.on('connection', (socket) => {
  const room = rooms.get(socket.data.roomId);
  const member = room?.members.get(socket.data.memberId);

  if (!room || !member) {
    socket.disconnect(true);
    return;
  }

  const previousSocketId = member.socketId;
  const wasPending = !member.socketId;
  member.socketId = socket.id;
  socket.join(room.id);

  if (previousSocketId && previousSocketId !== socket.id) {
    const previousSocket = io.sockets.sockets.get(previousSocketId);
    if (previousSocket) {
      previousSocket.emit('room:error', {
        message: 'This room was reopened in another tab. The older tab has been disconnected.'
      });
      previousSocket.disconnect(true);
    }
  }

  if (wasPending) {
    room.messages.push(systemMessage(`${member.name} joined the room.`));
    trimArray(room.messages, MAX_MESSAGES);
    touchRoomActivity(room);
    schedulePersist();
  }

  const snapshot = roomSnapshot(room);
  socket.emit('room:state', snapshot);
  socket.to(room.id).emit('room:state', snapshot);

  socket.on('chat:message', (payload = {}) => {
    try {
      const liveRoom = rooms.get(room.id);
      const liveMember = liveRoom?.members.get(member.id);
      if (!liveRoom || !liveMember || liveMember.socketId !== socket.id) {
        return;
      }

      const rawText = typeof payload.text === 'string' ? payload.text : String(payload || '');
      const text = rawText.trim();
      if (!text) {
        return;
      }
      if (text.length > 600) {
        throw httpError(400, 'Messages are limited to 600 characters.');
      }

      liveRoom.messages.push(userMessage(liveMember, text));
      trimArray(liveRoom.messages, MAX_MESSAGES);
      touchRoomActivity(liveRoom);
      schedulePersist();
      broadcastRoomState(liveRoom);
    } catch (error) {
      socket.emit('room:error', { message: error.message || 'Message failed.' });
    }
  });

  socket.on('disconnect', () => {
    const liveRoom = rooms.get(room.id);
    const liveMember = liveRoom?.members.get(member.id);
    if (!liveRoom || !liveMember || liveMember.socketId !== socket.id) {
      return;
    }

    removeMember(liveRoom, liveMember.id, { announce: true });
    broadcastRoomState(liveRoom);
  });
});

setInterval(() => {
  expireInactiveRooms();

  const cutoff = Date.now() - PENDING_MEMBER_TTL_MS;
  for (const room of rooms.values()) {
    let changed = false;
    for (const member of [...room.members.values()]) {
      if (member.socketId) {
        continue;
      }

      const joinedAt = new Date(member.joinedAt).getTime();
      if (Number.isFinite(joinedAt) && joinedAt < cutoff) {
        removeMember(room, member.id, { announce: false });
        changed = true;
      }
    }

    if (changed) {
      broadcastRoomState(room);
    }
  }
}, 60 * 1000).unref();

server.listen(PORT, () => {
  console.log(`RoomDock is running on http://localhost:${PORT}`);
});
