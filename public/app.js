const els = {
  resumeCard: document.getElementById('resumeCard'),
  resumeSummary: document.getElementById('resumeSummary'),
  resumeButton: document.getElementById('resumeButton'),
  clearResumeButton: document.getElementById('clearResumeButton'),
  landingSection: document.getElementById('landingSection'),
  roomSection: document.getElementById('roomSection'),
  createForm: document.getElementById('createForm'),
  joinForm: document.getElementById('joinForm'),
  createRoomName: document.getElementById('createRoomName'),
  createHostName: document.getElementById('createHostName'),
  createPassword: document.getElementById('createPassword'),
  joinRoomCode: document.getElementById('joinRoomCode'),
  joinName: document.getElementById('joinName'),
  joinPassword: document.getElementById('joinPassword'),
  createSubmit: document.getElementById('createSubmit'),
  joinSubmit: document.getElementById('joinSubmit'),
  roomTitle: document.getElementById('roomTitle'),
  roomSubtitle: document.getElementById('roomSubtitle'),
  roomCodeValue: document.getElementById('roomCodeValue'),
  roomPasswordValue: document.getElementById('roomPasswordValue'),
  roomMembersValue: document.getElementById('roomMembersValue'),
  roomStorageValue: document.getElementById('roomStorageValue'),
  memberCountBadge: document.getElementById('memberCountBadge'),
  membersList: document.getElementById('membersList'),
  messageList: document.getElementById('messageList'),
  messageForm: document.getElementById('messageForm'),
  messageInput: document.getElementById('messageInput'),
  copyInviteButton: document.getElementById('copyInviteButton'),
  togglePasswordButton: document.getElementById('togglePasswordButton'),
  leaveButton: document.getElementById('leaveButton'),
  dropZone: document.getElementById('dropZone'),
  pickFilesButton: document.getElementById('pickFilesButton'),
  pickFolderButton: document.getElementById('pickFolderButton'),
  fileInput: document.getElementById('fileInput'),
  folderInput: document.getElementById('folderInput'),
  fileSearchInput: document.getElementById('fileSearchInput'),
  fileSearchClearButton: document.getElementById('fileSearchClearButton'),
  fileSearchSummary: document.getElementById('fileSearchSummary'),
  roomZipButton: document.getElementById('roomZipButton'),
  folderList: document.getElementById('folderList'),
  uploadQueue: document.getElementById('uploadQueue'),
  fileList: document.getElementById('fileList'),
  roomToolsModal: document.getElementById('roomToolsModal'),
  roomToolsBackdrop: document.getElementById('roomToolsBackdrop'),
  roomToolsCloseButton: document.getElementById('roomToolsCloseButton'),
  roomInviteLink: document.getElementById('roomInviteLink'),
  roomInviteCode: document.getElementById('roomInviteCode'),
  roomInvitePassword: document.getElementById('roomInvitePassword'),
  roomInviteCopyLinkButton: document.getElementById('roomInviteCopyLinkButton'),
  roomInviteCopyCodeButton: document.getElementById('roomInviteCopyCodeButton'),
  roomInviteCopyPasswordButton: document.getElementById('roomInviteCopyPasswordButton'),
  roomInviteCopyTextButton: document.getElementById('roomInviteCopyTextButton'),
  roomQrImage: document.getElementById('roomQrImage'),
  roomSettingsSection: document.getElementById('roomSettingsSection'),
  roomSettingsForm: document.getElementById('roomSettingsForm'),
  roomSettingsName: document.getElementById('roomSettingsName'),
  roomSettingsPassword: document.getElementById('roomSettingsPassword'),
  roomSettingsExpiry: document.getElementById('roomSettingsExpiry'),
  roomSettingsSaveButton: document.getElementById('roomSettingsSaveButton'),
  toastLayer: document.getElementById('toastLayer')
};

const state = {
  socket: null,
  room: null,
  session: loadSession(),
  leaving: false,
  reconnectTimer: null,
  uploadQueue: [],
  uploadRunning: false,
  passwordVisible: false,
  currentMember: null,
  isHost: false,
  fileSearchQuery: '',
  roomToolsOpen: false
};

function loadSession() {
  return null;
}

function normalizeSession(session) {
  if (!session) {
    return null;
  }

  return {
    roomCode: String(session.roomCode || session.roomId || '').trim().toUpperCase(),
    roomName: String(session.roomName || '').trim(),
    password: String(session.password || '').trim(),
    displayName: String(session.displayName || session.name || '').trim(),
    token: String(session.token || '').trim(),
    memberId: String(session.memberId || '').trim()
  };
}

function saveSession(session) {
  state.session = normalizeSession(session);
  refreshResumeCard();
}

function clearSession() {
  state.session = null;
  refreshResumeCard();
}

function refreshResumeCard() {
  const hasSession = Boolean(state.session?.roomCode);
  const shouldShow = hasSession && (!state.socket || !state.socket.connected);
  els.resumeCard.classList.toggle('hidden', !shouldShow);

  if (shouldShow) {
    const roomLabel = state.session.roomName ? `Room ${state.session.roomName}` : `Room ${state.session.roomCode}`;
    els.resumeSummary.textContent = `${roomLabel} is active in this tab. Refreshing the page will require the room details again.`;
  }
}

function setFormValuesFromSession() {
  if (!state.session) {
    return;
  }

  if (state.session.roomCode) {
    els.joinRoomCode.value = state.session.roomCode;
  }
  if (state.session.displayName) {
    els.joinName.value = state.session.displayName;
    els.createHostName.value = state.session.displayName;
  }
  if (state.session.roomName) {
    els.createRoomName.value = state.session.roomName;
  }
  if (state.session.password) {
    els.joinPassword.value = state.session.password;
    els.createPassword.value = state.session.password;
  }
}

function showLanding() {
  els.landingSection.classList.remove('hidden');
  els.roomSection.classList.add('hidden');
  document.title = 'RoomDock';
}

function showRoomShell() {
  els.landingSection.classList.add('hidden');
  els.roomSection.classList.remove('hidden');
}

function setBusy(button, busy, text) {
  button.disabled = busy;
  if (text) {
    button.dataset.label = button.dataset.label || button.textContent;
    button.textContent = busy ? text : button.dataset.label;
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toast(message, type = 'info') {
  const item = document.createElement('div');
  item.className = `toast ${type}`;
  item.innerHTML = `<p>${escapeHtml(message)}</p>`;
  els.toastLayer.appendChild(item);
  window.setTimeout(() => {
    item.remove();
  }, 3600);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let index = 0;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  const decimals = index === 0 || size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(decimals)} ${units[index]}`;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  }).format(new Date(iso));
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) {
    return 'RD';
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || 'Request failed.');
  }
  return payload;
}

function updateRoomShellStatus(text) {
  els.roomSubtitle.textContent = text;
}

function normalizeSearchQuery(value) {
  return String(value || '').trim().toLowerCase();
}

function getFileExtension(name) {
  const text = String(name || '').trim().toLowerCase();
  const index = text.lastIndexOf('.');
  return index >= 0 ? text.slice(index + 1) : '';
}

function getFileTypeInfo(file) {
  const mimeType = String(file?.mimeType || '').toLowerCase();
  const extension = getFileExtension(file?.name || file?.relativePath);

  if (mimeType.startsWith('image/')) {
    return { label: 'Image', short: 'IMG', category: 'image', previewable: true };
  }
  if (mimeType.startsWith('video/')) {
    return { label: 'Video', short: 'VID', category: 'video', previewable: false };
  }
  if (mimeType.startsWith('audio/')) {
    return { label: 'Audio', short: 'AUD', category: 'audio', previewable: false };
  }
  if (mimeType.includes('pdf') || extension === 'pdf') {
    return { label: 'PDF', short: 'PDF', category: 'pdf', previewable: false };
  }
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) {
    return { label: 'Archive', short: 'ZIP', category: 'archive', previewable: false };
  }
  if (['txt', 'md', 'json', 'csv', 'xml', 'yaml', 'yml', 'log'].includes(extension)) {
    return { label: 'Text', short: 'TXT', category: 'text', previewable: false };
  }
  if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'scss', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'go', 'rs', 'sh'].includes(extension)) {
    return { label: 'Code', short: 'CODE', category: 'code', previewable: false };
  }

  return {
    label: extension ? extension.toUpperCase().slice(0, 6) : 'File',
    short: extension ? extension.toUpperCase().slice(0, 4) : 'FILE',
    category: 'generic',
    previewable: false
  };
}

function matchesFileSearch(file, query) {
  if (!query) {
    return true;
  }

  const info = getFileTypeInfo(file);
  const haystack = [
    file?.name,
    file?.relativePath,
    file?.uploadedBy,
    file?.mimeType,
    file?.folderRoot,
    info.label,
    info.short
  ]
    .map((value) => String(value || '').toLowerCase())
    .join(' ');

  return haystack.includes(query);
}

function fileDownloadUrl(file) {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(
    state.session.token
  )}`;
}

function filePreviewUrl(file) {
  const downloadUrl = fileDownloadUrl(file);
  if (!downloadUrl) {
    return null;
  }

  return downloadUrl.replace(/\/files\/([^/?]+)\?/, '/files/$1/preview?');
}

function roomZipUrl() {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/zip?token=${encodeURIComponent(state.session.token)}`;
}

function folderZipUrl(root) {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/folders/${encodeURIComponent(root)}/zip?token=${encodeURIComponent(
    state.session.token
  )}`;
}

function folderDeleteUrl(root) {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/folders/${encodeURIComponent(root)}?token=${encodeURIComponent(
    state.session.token
  )}`;
}

function inviteLinkUrl() {
  if (!state.room) {
    return '';
  }

  const url = new URL(window.location.href);
  url.search = '';
  url.searchParams.set('room', state.room.id);
  return url.toString();
}

function getVisibleFolderGroups(files) {
  const query = normalizeSearchQuery(state.fileSearchQuery);
  const groups = buildFolderGroups(files);

  if (!query) {
    return groups;
  }

  return groups.filter((group) => {
    if (String(group.root || '').toLowerCase().includes(query)) {
      return true;
    }

    return group.files.some((file) => matchesFileSearch(file, query));
  });
}

function getVisibleStandaloneFiles(files) {
  const query = normalizeSearchQuery(state.fileSearchQuery);
  const standalone = files.filter((file) => !file.folderRoot);

  if (!query) {
    return standalone;
  }

  return standalone.filter((file) => matchesFileSearch(file, query));
}

function updateFileSearchSummary(files) {
  const query = normalizeSearchQuery(state.fileSearchQuery);
  if (!query) {
    els.fileSearchSummary.textContent = 'Search across uploaded files, folders, uploaders, and file types.';
    return;
  }

  const standaloneCount = getVisibleStandaloneFiles(files).length;
  const folderCount = getVisibleFolderGroups(files).length;
  const fileLabel = `${standaloneCount} file${standaloneCount === 1 ? '' : 's'}`;
  const folderLabel = `${folderCount} folder${folderCount === 1 ? '' : 's'}`;

  if (!standaloneCount && !folderCount) {
    els.fileSearchSummary.textContent = `No files or folders match "${query}".`;
    return;
  }

  els.fileSearchSummary.textContent = `Showing ${fileLabel} and ${folderLabel} matching "${query}".`;
}

function buildInviteText() {
  const link = inviteLinkUrl();
  const code = state.room?.id || '----';
  const password = state.isHost ? state.session?.password || '' : 'Ask the host';

  return [
    'RoomDock invite',
    `Invite link: ${link}`,
    `Room code: ${code}`,
    `Password: ${password}`,
    'Open the link, enter your name, and join with the password above.'
  ].join('\n');
}

async function copyText(text, successMessage = 'Copied to clipboard.') {
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage, 'success');
  } catch {
    window.prompt('Copy this text', text);
  }
}

function setModalOpen(open) {
  state.roomToolsOpen = open;
  document.body.classList.toggle('modal-open', open);
  els.roomToolsModal.classList.toggle('hidden', !open);
  els.roomToolsModal.setAttribute('aria-hidden', open ? 'false' : 'true');
}

function renderRoomTools() {
  if (!state.room || !state.session) {
    return;
  }

  const inviteLink = inviteLinkUrl();
  els.roomInviteLink.value = inviteLink;
  els.roomInviteCode.value = state.room.id;
  els.roomInvitePassword.value = state.isHost ? state.session.password || '' : 'Ask the host';
  els.roomQrImage.src = `${encodeURI(`/api/rooms/${encodeURIComponent(state.room.id)}/invite-qr?token=${encodeURIComponent(
    state.session.token
  )}`)}&_=${Date.now()}`;

  els.roomSettingsSection.classList.toggle('hidden', !state.isHost);
  els.roomSettingsName.value = state.room.name || '';
  els.roomSettingsPassword.value = state.session.password || '';
  els.roomSettingsExpiry.value = String(Number(state.room.inactiveExpiresAfterMinutes) || 0);

  els.roomInviteCopyLinkButton.disabled = !inviteLink;
  els.roomInviteCopyCodeButton.disabled = !state.room.id;
  els.roomInviteCopyPasswordButton.disabled = !state.isHost || !state.session.password;
  els.roomInviteCopyPasswordButton.textContent = state.isHost ? 'Copy' : 'Host only';
  els.roomInviteCopyTextButton.disabled = !inviteLink;
  els.roomSettingsSaveButton.disabled = !state.isHost;
}

function openRoomTools() {
  if (!state.room || !state.session) {
    return;
  }

  setModalOpen(true);
  renderRoomTools();
}

function closeRoomTools() {
  setModalOpen(false);
}

function buildFolderGroups(files) {
  const groups = new Map();

  for (const file of files) {
    if (!file.folderRoot) {
      continue;
    }

    const entry = groups.get(file.folderRoot) || {
      root: file.folderRoot,
      files: [],
      size: 0
    };

    entry.files.push(file);
    entry.size += Number(file.size) || 0;
    groups.set(file.folderRoot, entry);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      files: group.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    }))
    .sort((a, b) => a.root.localeCompare(b.root));
}

function folderZipUrl(root) {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/folders/${encodeURIComponent(root)}/zip?token=${encodeURIComponent(
    state.session.token
  )}`;
}

function folderDeleteUrl(root) {
  if (!state.room || !state.session) {
    return null;
  }

  return `/api/rooms/${encodeURIComponent(state.room.id)}/folders/${encodeURIComponent(root)}?token=${encodeURIComponent(
    state.session.token
  )}`;
}

function renderFolders(files) {
  els.folderList.innerHTML = '';

  const groups = buildFolderGroups(files);
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Upload a folder to see one-click zip downloads here.';
    els.folderList.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const card = document.createElement('article');
    card.className = 'folder-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'folder-title-row';

    const icon = document.createElement('div');
    icon.className = 'folder-icon';
    icon.textContent = 'ZIP';

    const meta = document.createElement('div');
    meta.className = 'folder-meta';

    const title = document.createElement('strong');
    title.textContent = group.root;

    const details = document.createElement('span');
    details.textContent = `${group.files.length} file${group.files.length === 1 ? '' : 's'} · ${formatBytes(group.size)}`;

    meta.append(title, details);
    titleRow.append(icon, meta);

    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const button = document.createElement('button');
    button.className = 'btn btn-ghost btn-mini';
    button.type = 'button';
    button.textContent = 'Download ZIP';
    button.addEventListener('click', () => {
      const url = folderZipUrl(group.root);
      if (url) {
        window.location.href = url;
      }
    });

    actions.appendChild(button);

    if (state.isHost) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-ghost btn-mini danger-mini';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteFolder(group.root));
      actions.appendChild(deleteButton);
    }

    card.append(titleRow, actions);
    els.folderList.appendChild(card);
  }
}

function renderMembers(members) {
  els.membersList.innerHTML = '';

  if (!members.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No one is connected yet.';
    els.membersList.appendChild(empty);
    return;
  }

  for (const member of members) {
    const card = document.createElement('article');
    card.className = 'member-card';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(member.name);

    const meta = document.createElement('div');
    meta.className = 'member-meta';

    const title = document.createElement('strong');
    title.textContent = member.name;

    const detail = document.createElement('span');
    detail.textContent = `Joined ${formatTime(member.joinedAt)}`;

    meta.append(title, detail);
    const side = document.createElement('div');
    side.className = 'member-side';

    const isSelf = state.session?.memberId && member.id === state.session.memberId;

    if (member.isHost) {
      const host = document.createElement('span');
      host.className = 'badge host';
      host.textContent = 'Host';
      side.appendChild(host);
    } else if (isSelf) {
      const self = document.createElement('span');
      self.className = 'badge self';
      self.textContent = 'You';
      side.appendChild(self);
    }

    if (state.isHost && !member.isHost && !isSelf) {
      const actions = document.createElement('div');
      actions.className = 'member-actions';

      const transferButton = document.createElement('button');
      transferButton.className = 'btn btn-ghost btn-mini';
      transferButton.type = 'button';
      transferButton.textContent = 'Make host';
      transferButton.addEventListener('click', () => transferHost(member));

      const kickButton = document.createElement('button');
      kickButton.className = 'btn btn-ghost btn-mini danger-mini';
      kickButton.type = 'button';
      kickButton.textContent = 'Kick';
      kickButton.addEventListener('click', () => kickMember(member));

      actions.append(transferButton, kickButton);
      side.appendChild(actions);
    }

    card.append(avatar, meta);
    if (side.childNodes.length) {
      card.append(side);
    }

    els.membersList.appendChild(card);
  }
}

function renderMessages(messages) {
  els.messageList.innerHTML = '';

  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'Say hello. Messages will appear here in real time.';
    els.messageList.appendChild(empty);
    return;
  }

  for (const message of messages) {
    const card = document.createElement('article');
    card.className = `message-card ${message.kind === 'system' ? 'system' : ''}`;

    if (message.kind === 'system') {
      const body = document.createElement('p');
      body.className = 'message-body';
      body.textContent = message.text;
      card.appendChild(body);
    } else {
      if (state.session?.memberId && message.authorId === state.session.memberId) {
        card.classList.add('self');
      }

      const head = document.createElement('div');
      head.className = 'message-head';

      const author = document.createElement('strong');
      author.textContent = message.authorName;

      const time = document.createElement('span');
      time.className = 'muted';
      time.textContent = formatTime(message.createdAt);

      head.append(author, time);

      const body = document.createElement('p');
      body.className = 'message-body';
      body.textContent = message.text;

      card.append(head, body);
    }

    els.messageList.appendChild(card);
  }

  els.messageList.scrollTop = els.messageList.scrollHeight;
}

function renderFiles(files) {
  els.fileList.innerHTML = '';

  const standaloneFiles = files.filter((file) => !file.folderRoot);

  if (!standaloneFiles.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No standalone files yet. Folder uploads appear in the Folders section below.';
    els.fileList.appendChild(empty);
    return;
  }

  for (const file of standaloneFiles) {
    const card = document.createElement('article');
    card.className = 'file-card';

    const top = document.createElement('div');
    top.className = 'file-top';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = initials(file.uploadedBy);

    const main = document.createElement('div');
    main.className = 'file-main';

    const title = document.createElement('strong');
    title.textContent = file.name;

    const pathLabel = document.createElement('div');
    pathLabel.className = 'file-path';
    pathLabel.textContent = file.relativePath || file.name;

    const metaRow = document.createElement('div');
    metaRow.className = 'file-row';
    metaRow.innerHTML = `<span>${escapeHtml(file.uploadedBy)}</span><span>${escapeHtml(formatBytes(file.size))} · ${escapeHtml(
      formatTime(file.uploadedAt)
    )}</span>`;

    main.append(title, pathLabel, metaRow);
    top.append(avatar, main);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const button = document.createElement('button');
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.textContent = 'Download';
    button.addEventListener('click', () => {
      if (!state.session || !state.room) {
        return;
      }
      const url = `/api/rooms/${encodeURIComponent(state.room.id)}/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(
        state.session.token
      )}`;
      window.location.href = url;
    });

    actions.appendChild(button);

    if (state.isHost) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-ghost danger-mini';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteFile(file));
      actions.appendChild(deleteButton);
    }

    card.append(top, actions);
    els.fileList.appendChild(card);
  }
}

function renderUploadQueue() {
  els.uploadQueue.innerHTML = '';

  if (!state.uploadQueue.length) {
    return;
  }

  for (const item of state.uploadQueue) {
    const card = document.createElement('article');
    card.className = 'upload-card';

    const meta = document.createElement('div');
    meta.className = 'upload-meta';

    const title = document.createElement('strong');
    title.textContent = item.relativePath;

    const subtitle = document.createElement('span');
    subtitle.textContent = `${formatBytes(item.file.size)} · ${item.status}`;

    meta.append(title, subtitle);

    const bar = document.createElement('div');
    bar.className = 'upload-bar';
    const fill = document.createElement('span');
    fill.style.width = `${item.progress}%`;
    bar.appendChild(fill);

    const stateLine = document.createElement('div');
    stateLine.className = 'upload-state';
    stateLine.textContent = item.message || item.status;

    card.append(meta, bar, stateLine);
    els.uploadQueue.appendChild(card);
  }
}

function renderRoom(room) {
  if (!room) {
    return;
  }

  state.currentMember = (room.members || []).find((member) => member.id === state.session?.memberId) || null;
  state.isHost = Boolean(state.currentMember?.isHost);

  document.title = `${room.name} | RoomDock`;
  els.roomTitle.textContent = room.name;
  els.roomCodeValue.textContent = room.id;
  els.roomMembersValue.textContent = `${room.memberCount} / ${room.memberLimit}`;
  els.memberCountBadge.textContent = `${room.memberCount} people`;
  els.roomStorageValue.textContent = formatBytes(room.storageBytes);
  els.togglePasswordButton.textContent = state.passwordVisible ? 'Hide password' : 'Show password';
  els.roomPasswordValue.textContent = state.session?.password
    ? state.passwordVisible
      ? state.session.password
      : 'Hidden'
    : 'Hidden';
  els.roomSubtitle.textContent = `${room.hostName || 'No active host'} · Library ${formatBytes(room.storageBytes)}`;

  renderMembers(room.members || []);
  renderFolders(room.files || []);
  renderMessages(room.messages || []);
  renderFiles(room.files || []);
  renderUploadQueue();
}

function connectSocket(session) {
  const previousSocket = state.socket;
  if (previousSocket) {
    previousSocket.removeAllListeners();
    previousSocket.disconnect();
  }

  state.leaving = false;
  clearTimeout(state.reconnectTimer);

  const socket = io({
    reconnection: false,
    auth: {
      token: session.token
    }
  });

  state.socket = socket;
  updateRoomShellStatus('Connecting to the room...');

  socket.on('connect', () => {
    updateRoomShellStatus('Connected');
    refreshResumeCard();
  });

  socket.on('room:state', (room) => {
    state.room = room;
    renderRoom(room);
  });

  socket.on('room:error', (payload) => {
    toast(payload?.message || 'Something in the room needs attention.', 'error');
  });

  socket.on('room:kicked', (payload = {}) => {
    toast(payload.message || 'You were removed from the room.', 'error');
    disconnectSocket(true);
    showLanding();
  });

  socket.on('disconnect', (reason) => {
    if (state.leaving) {
      updateRoomShellStatus('Left room');
      refreshResumeCard();
      return;
    }

    updateRoomShellStatus(`Disconnected: ${reason}`);
    refreshResumeCard();
    toast('Connection lost. Trying to rejoin the room.', 'error');
    scheduleReconnect();
  });

  socket.on('connect_error', (error) => {
    updateRoomShellStatus('Connection failed');
    toast(error.message || 'Unable to connect to the room.', 'error');
  });
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = window.setTimeout(async () => {
    if (!state.session || state.leaving) {
      return;
    }

    try {
      const data = await postJson(`/api/rooms/${encodeURIComponent(state.session.roomCode)}/join`, {
        name: state.session.displayName,
        password: state.session.password
      });

      const session = {
        roomCode: data.room.id,
        roomName: data.room.name,
        password: state.session.password,
        displayName: state.session.displayName,
        token: data.session.token,
        memberId: data.session.memberId
      };

      saveSession(session);
      connectSocket(session);
      state.room = data.room;
      showRoomShell();
      renderRoom(data.room);
      toast('Rejoined the room.', 'success');
    } catch (error) {
      toast(error.message || 'Auto rejoin failed. Use the form to join again.', 'error');
      disconnectSocket(false);
      showLanding();
      setFormValuesFromSession();
    }
  }, 1200);
}

function disconnectSocket(clearSavedSession = true) {
  state.leaving = true;
  clearTimeout(state.reconnectTimer);

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (clearSavedSession) {
    clearSession();
  }

  state.room = null;
  state.currentMember = null;
  state.isHost = false;
  updateRoomShellStatus('Waiting to connect...');
}

function beginSession(session, room, { announce = true } = {}) {
  const normalized = normalizeSession(session);
  saveSession(normalized);
  showRoomShell();
  state.room = room || null;
  renderRoom(room || null);
  connectSocket(normalized);

  if (announce) {
    toast(`Joined ${normalized.roomName || normalized.roomCode}.`, 'success');
  }
}

function addUploadItems(files) {
  for (const file of files) {
    const relativePath = String(file.webkitRelativePath || file.relativePath || file.name);
    state.uploadQueue.push({
      id: crypto.randomUUID(),
      file,
      relativePath,
      progress: 0,
      status: 'Queued',
      message: 'Waiting to upload'
    });
  }

  renderUploadQueue();
  processUploadQueue();
}

async function processUploadQueue() {
  if (state.uploadRunning || !state.room || !state.session) {
    return;
  }

  state.uploadRunning = true;
  try {
    for (const item of state.uploadQueue) {
      if (item.status !== 'Queued') {
        continue;
      }

      item.status = 'Uploading';
      item.message = `Sending ${item.relativePath}`;
      item.progress = 0;
      renderUploadQueue();

      try {
        await uploadSingleFile(item);
        item.status = 'Done';
        item.message = 'Uploaded successfully';
        item.progress = 100;
        toast(`Uploaded ${item.relativePath}`, 'success');
      } catch (error) {
        item.status = 'Failed';
        item.message = error.message || 'Upload failed';
        toast(`${item.relativePath}: ${item.message}`, 'error');
      }

      renderUploadQueue();
    }
  } finally {
    state.uploadRunning = false;
  }
}

function uploadSingleFile(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append('token', state.session.token);
    form.append('roomId', state.room.id);
    form.append('relativePath', item.relativePath);
    form.append('file', item.file, item.file.name);

    item.xhr = xhr;
    xhr.open('POST', `/api/rooms/${encodeURIComponent(state.room.id)}/upload`);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        item.progress = Math.min(100, Math.round((event.loaded / event.total) * 100));
        item.message = `${formatBytes(event.loaded)} of ${formatBytes(event.total)}`;
        renderUploadQueue();
      }
    };

    xhr.onload = () => {
      item.xhr = null;
      const body = xhr.response || {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
        return;
      }
      reject(new Error(body.error || 'Upload failed.'));
    };

    xhr.onerror = () => {
      item.xhr = null;
      reject(new Error('Upload failed. Check your connection and try again.'));
    };

    xhr.onabort = () => {
      item.xhr = null;
      reject(new Error('Upload cancelled.'));
    };

    xhr.send(form);
  });
}

function abortUploads() {
  for (const item of state.uploadQueue) {
    if (item.xhr) {
      item.xhr.abort();
      item.xhr = null;
    }
  }
  state.uploadQueue = [];
  renderUploadQueue();
}

async function deleteFile(file) {
  if (!state.room || !state.session) {
    return;
  }

  if (!window.confirm(`Delete "${file.relativePath || file.name}" for everyone in the room?`)) {
    return;
  }

  try {
    const response = await fetch(
      `/api/rooms/${encodeURIComponent(state.room.id)}/files/${encodeURIComponent(file.id)}?token=${encodeURIComponent(
        state.session.token
      )}`,
      {
        method: 'DELETE'
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to delete the file.');
    }
    toast(`Deleted ${file.relativePath || file.name}.`, 'success');
  } catch (error) {
    toast(error.message || 'Unable to delete the file.', 'error');
  }
}

async function deleteFolder(folderRoot) {
  if (!state.room || !state.session) {
    return;
  }

  if (!window.confirm(`Delete the entire folder "${folderRoot}" for everyone in the room?`)) {
    return;
  }

  try {
    const response = await fetch(folderDeleteUrl(folderRoot), {
      method: 'DELETE'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Unable to delete the folder.');
    }
    toast(`Deleted folder ${folderRoot}.`, 'success');
  } catch (error) {
    toast(error.message || 'Unable to delete the folder.', 'error');
  }
}

async function kickMember(member) {
  if (!state.room || !state.session) {
    return;
  }

  if (!window.confirm(`Remove ${member.name} from the room?`)) {
    return;
  }

  try {
    const data = await postJson(
      `/api/rooms/${encodeURIComponent(state.room.id)}/members/${encodeURIComponent(member.id)}/kick?token=${encodeURIComponent(
        state.session.token
      )}`,
      {}
    );
    toast(`${member.name} was removed.`, 'success');
    state.room = data.room || state.room;
  } catch (error) {
    toast(error.message || 'Unable to remove that member.', 'error');
  }
}

async function transferHost(member) {
  if (!state.room || !state.session) {
    return;
  }

  if (!window.confirm(`Make ${member.name} the host of this room?`)) {
    return;
  }

  try {
    const data = await postJson(
      `/api/rooms/${encodeURIComponent(state.room.id)}/host/transfer?token=${encodeURIComponent(state.session.token)}`,
      { memberId: member.id }
    );
    toast(`${member.name} is now the host.`, 'success');
    state.room = data.room || state.room;
  } catch (error) {
    toast(error.message || 'Unable to transfer host rights.', 'error');
  }
}

async function copyInvite() {
  if (!state.room || !state.session) {
    return;
  }

  const invite = [
    'RoomDock invite',
    `Room code: ${state.room.id}`,
    `Password: ${state.session.password}`,
    `Name: ${state.session.displayName}`,
    'Open the app and join with the room code, your name, and the password.'
  ].join('\n');

  try {
    await navigator.clipboard.writeText(invite);
    toast('Invite copied to clipboard.', 'success');
  } catch {
    window.prompt('Copy this invite', invite);
  }
}

function autoGrowTextarea(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
}

async function sendMessage(event) {
  event.preventDefault();

  if (!state.socket || !state.room || !state.session) {
    return;
  }

  const text = els.messageInput.value.trim();
  if (!text) {
    return;
  }

  state.socket.emit('chat:message', { text });
  els.messageInput.value = '';
  autoGrowTextarea(els.messageInput);
}

async function rejoinSavedSession() {
  if (!state.session) {
    return;
  }

  const saved = state.session;
  try {
    toast('Rejoining room...', 'success');
    const data = await postJson(`/api/rooms/${encodeURIComponent(saved.roomCode)}/join`, {
      name: saved.displayName,
      password: saved.password
    });

    const session = {
      roomCode: data.room.id,
      roomName: data.room.name,
      password: saved.password,
      displayName: saved.displayName,
      token: data.session.token,
      memberId: data.session.memberId
    };

    beginSession(session, data.room, { announce: false });
  } catch (error) {
    toast(error.message || 'Could not rejoin the room.', 'error');
  }
}

function leaveRoom() {
  state.leaving = true;
  clearTimeout(state.reconnectTimer);
  abortUploads();
  disconnectSocket(true);
  showLanding();
  toast('You left the room.', 'success');
}

function renderLandingState() {
  showLanding();
  refreshResumeCard();
  setFormValuesFromSession();
}

function wireEvents() {
  els.createForm.addEventListener('submit', createRoomHandler);
  els.joinForm.addEventListener('submit', joinRoomHandler);
  els.copyInviteButton.addEventListener('click', copyInvite);
  els.togglePasswordButton.addEventListener('click', () => {
    state.passwordVisible = !state.passwordVisible;
    if (state.room) {
      renderRoom(state.room);
    }
  });
  els.leaveButton.addEventListener('click', leaveRoom);
  els.messageForm.addEventListener('submit', sendMessage);
  els.messageInput.addEventListener('input', () => autoGrowTextarea(els.messageInput));
  els.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!els.messageForm.querySelector('button').disabled) {
        els.messageForm.requestSubmit();
      }
    }
  });

  els.pickFilesButton.addEventListener('click', () => els.fileInput.click());
  els.pickFolderButton.addEventListener('click', () => els.folderInput.click());

  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files?.length) {
      addUploadItems([...els.fileInput.files]);
      els.fileInput.value = '';
    }
  });

  els.folderInput.addEventListener('change', () => {
    if (els.folderInput.files?.length) {
      addUploadItems([...els.folderInput.files]);
      els.folderInput.value = '';
    }
  });

  els.dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  els.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('dragover');
  });
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) {
      addUploadItems(files);
    }
  });

  els.resumeButton.addEventListener('click', () => {
    if (state.session) {
      rejoinSavedSession();
    }
  });

  els.clearResumeButton.addEventListener('click', () => {
    disconnectSocket(true);
    showLanding();
    toast('Room details cleared. You will need to join again.', 'success');
  });
}

async function createRoomHandler(event) {
  event.preventDefault();
  setBusy(els.createSubmit, true, 'Creating...');

  try {
    const payload = {
      roomName: els.createRoomName.value.trim(),
      hostName: els.createHostName.value.trim(),
      password: els.createPassword.value
    };

    const data = await postJson('/api/rooms', payload);
    const session = {
      roomCode: data.room.id,
      roomName: data.room.name,
      password: payload.password,
      displayName: payload.hostName,
      token: data.session.token,
      memberId: data.session.memberId
    };

    beginSession(session, data.room);
    toast(`Created room ${data.room.id}.`, 'success');
  } catch (error) {
    toast(error.message || 'Unable to create the room.', 'error');
  } finally {
    setBusy(els.createSubmit, false);
  }
}

async function joinRoomHandler(event) {
  event.preventDefault();
  setBusy(els.joinSubmit, true, 'Joining...');

  try {
    const roomCode = els.joinRoomCode.value.trim().toUpperCase();
    const payload = {
      name: els.joinName.value.trim(),
      password: els.joinPassword.value
    };

    const data = await postJson(`/api/rooms/${encodeURIComponent(roomCode)}/join`, payload);
    const session = {
      roomCode: data.room.id,
      roomName: data.room.name,
      password: payload.password,
      displayName: payload.name,
      token: data.session.token,
      memberId: data.session.memberId
    };

    beginSession(session, data.room);
  } catch (error) {
    toast(error.message || 'Unable to join the room.', 'error');
  } finally {
    setBusy(els.joinSubmit, false);
  }
}

function init() {
  wireEvents();
  els.createForm.reset();
  els.joinForm.reset();
  refreshResumeCard();
  setFormValuesFromSession();
  renderLandingState();
}

function applyInviteParams() {
  const params = new URLSearchParams(window.location.search);
  const roomCode = String(params.get('room') || params.get('roomCode') || params.get('code') || '').trim().toUpperCase();

  if (roomCode && !els.joinRoomCode.value) {
    els.joinRoomCode.value = roomCode;
  }
}

function copyInvite() {
  openRoomTools();
}

async function copyInviteText() {
  await copyText(buildInviteText(), 'Invite text copied to clipboard.');
}

async function copyRoomLink() {
  const link = inviteLinkUrl();
  if (link) {
    await copyText(link, 'Invite link copied to clipboard.');
  }
}

async function copyRoomCode() {
  if (state.room?.id) {
    await copyText(state.room.id, 'Room code copied to clipboard.');
  }
}

async function copyRoomPassword() {
  if (state.isHost && state.session?.password) {
    await copyText(state.session.password, 'Password copied to clipboard.');
  }
}

async function saveRoomSettings(event) {
  event.preventDefault();

  if (!state.room || !state.session || !state.isHost) {
    return;
  }

  setBusy(els.roomSettingsSaveButton, true, 'Saving...');

  try {
    const payload = {
      roomName: els.roomSettingsName.value.trim(),
      password: els.roomSettingsPassword.value,
      inactiveMinutes: els.roomSettingsExpiry.value.trim()
    };

    const data = await postJson(`/api/rooms/${encodeURIComponent(state.room.id)}/settings?token=${encodeURIComponent(state.session.token)}`, payload);

    state.room = data.room;
    state.session.roomName = data.room.name;
    if (payload.password) {
      state.session.password = payload.password;
    }

    renderRoom(data.room);
    renderRoomTools();
    toast('Room settings saved.', 'success');
  } catch (error) {
    toast(error.message || 'Unable to save room settings.', 'error');
  } finally {
    setBusy(els.roomSettingsSaveButton, false);
  }
}

function renderFolders(files) {
  els.folderList.innerHTML = '';

  const groups = getVisibleFolderGroups(files);
  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = normalizeSearchQuery(state.fileSearchQuery)
      ? 'No folders match your search.'
      : 'Upload a folder to see one-click zip downloads here.';
    els.folderList.appendChild(empty);
    return;
  }

  for (const group of groups) {
    const card = document.createElement('article');
    card.className = 'folder-card';

    const titleRow = document.createElement('div');
    titleRow.className = 'folder-title-row';

    const icon = document.createElement('div');
    icon.className = 'folder-icon';
    icon.textContent = 'ZIP';

    const meta = document.createElement('div');
    meta.className = 'folder-meta';

    const title = document.createElement('strong');
    title.textContent = group.root;

    const details = document.createElement('span');
    details.textContent = `${group.files.length} file${group.files.length === 1 ? '' : 's'} - ${formatBytes(group.size)}`;

    meta.append(title, details);
    titleRow.append(icon, meta);

    const actions = document.createElement('div');
    actions.className = 'folder-actions';

    const zipButton = document.createElement('button');
    zipButton.className = 'btn btn-ghost btn-mini';
    zipButton.type = 'button';
    zipButton.textContent = 'Download ZIP';
    zipButton.addEventListener('click', () => {
      const url = folderZipUrl(group.root);
      if (url) {
        window.location.href = url;
      }
    });

    actions.appendChild(zipButton);

    if (state.isHost) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-ghost btn-mini danger-mini';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteFolder(group.root));
      actions.appendChild(deleteButton);
    }

    card.append(titleRow, actions);
    els.folderList.appendChild(card);
  }
}

function renderFiles(files) {
  els.fileList.innerHTML = '';

  const standaloneFiles = getVisibleStandaloneFiles(files);

  if (!standaloneFiles.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = normalizeSearchQuery(state.fileSearchQuery)
      ? 'No files match your search.'
      : 'No standalone files yet. Folder uploads appear in the Folders section below.';
    els.fileList.appendChild(empty);
    return;
  }

  for (const file of standaloneFiles) {
    const info = getFileTypeInfo(file);
    const card = document.createElement('article');
    card.className = 'file-card';

    const top = document.createElement('div');
    top.className = 'file-top';

    const media = document.createElement('div');
    media.className = 'file-media';
    if (info.previewable) {
      media.classList.add('preview');
      const preview = document.createElement('img');
      preview.className = 'file-preview';
      preview.src = filePreviewUrl(file) || '';
      preview.alt = `Preview of ${file.name}`;
      preview.loading = 'lazy';
      media.appendChild(preview);
    } else {
      media.classList.add('icon');
      media.textContent = info.short;
    }

    const main = document.createElement('div');
    main.className = 'file-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'file-title-row';

    const title = document.createElement('strong');
    title.textContent = file.name;

    const badge = document.createElement('span');
    badge.className = `file-type-badge ${info.category}`;
    badge.textContent = info.label;

    titleRow.append(title, badge);

    const pathLabel = document.createElement('div');
    pathLabel.className = 'file-path';
    pathLabel.textContent = file.relativePath || file.name;

    const metaRow = document.createElement('div');
    metaRow.className = 'file-row';
    metaRow.innerHTML = `<span>${escapeHtml(file.uploadedBy)}</span><span>${escapeHtml(formatBytes(file.size))} - ${escapeHtml(
      formatTime(file.uploadedAt)
    )}</span>`;

    main.append(titleRow, pathLabel, metaRow);
    top.append(media, main);

    const actions = document.createElement('div');
    actions.className = 'file-actions';

    const button = document.createElement('button');
    button.className = 'btn btn-ghost';
    button.type = 'button';
    button.textContent = 'Download';
    button.addEventListener('click', () => {
      const url = fileDownloadUrl(file);
      if (url) {
        window.location.href = url;
      }
    });

    actions.appendChild(button);

    if (state.isHost) {
      const deleteButton = document.createElement('button');
      deleteButton.className = 'btn btn-ghost danger-mini';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Delete';
      deleteButton.addEventListener('click', () => deleteFile(file));
      actions.appendChild(deleteButton);
    }

    card.append(top, actions);
    els.fileList.appendChild(card);
  }
}

function renderRoom(room) {
  if (!room) {
    return;
  }

  state.currentMember = (room.members || []).find((member) => member.id === state.session?.memberId) || null;
  state.isHost = Boolean(state.currentMember?.isHost);

  document.title = `${room.name} | RoomDock`;
  els.roomTitle.textContent = room.name;
  els.roomCodeValue.textContent = room.id;
  els.roomMembersValue.textContent = `${room.memberCount} / ${room.memberLimit}`;
  els.memberCountBadge.textContent = `${room.memberCount} people`;
  els.roomStorageValue.textContent = formatBytes(room.storageBytes);
  els.togglePasswordButton.textContent = state.passwordVisible ? 'Hide password' : 'Show password';
  els.roomPasswordValue.textContent = state.session?.password
    ? state.passwordVisible
      ? state.session.password
      : 'Hidden'
    : 'Hidden';
  els.roomZipButton.disabled = !(room.files || []).length;

  const idleText = Number(room.inactiveExpiresAfterMinutes) > 0 ? ` - Auto-expires after ${room.inactiveExpiresAfterMinutes} minute${room.inactiveExpiresAfterMinutes === 1 ? '' : 's'} idle` : '';
  els.roomSubtitle.textContent = `${room.hostName || 'No active host'} - Library ${formatBytes(room.storageBytes)}${idleText}`;

  updateFileSearchSummary(room.files || []);
  renderMembers(room.members || []);
  renderFolders(room.files || []);
  renderMessages(room.messages || []);
  renderFiles(room.files || []);
  renderUploadQueue();

  if (state.roomToolsOpen) {
    renderRoomTools();
  }
}

function beginSession(session, room, { announce = true } = {}) {
  const normalized = normalizeSession(session);
  saveSession(normalized);
  state.passwordVisible = false;
  state.fileSearchQuery = '';
  els.fileSearchInput.value = '';
  closeRoomTools();
  showRoomShell();
  state.room = room || null;
  renderRoom(room || null);
  connectSocket(normalized);

  if (announce) {
    toast(`Joined ${normalized.roomName || normalized.roomCode}.`, 'success');
  }
}

function disconnectSocket(clearSavedSession = true) {
  state.leaving = true;
  clearTimeout(state.reconnectTimer);
  closeRoomTools();

  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }

  if (clearSavedSession) {
    clearSession();
    els.createForm.reset();
    els.joinForm.reset();
    state.fileSearchQuery = '';
    els.fileSearchInput.value = '';
    applyInviteParams();
  }

  state.room = null;
  state.currentMember = null;
  state.isHost = false;
  updateRoomShellStatus('Waiting to connect...');
}

function leaveRoom() {
  state.leaving = true;
  clearTimeout(state.reconnectTimer);
  abortUploads();
  disconnectSocket(true);
  showLanding();
  toast('You left the room.', 'success');
}

function renderLandingState() {
  showLanding();
  refreshResumeCard();
  setFormValuesFromSession();
}

function wireEvents() {
  els.createForm.addEventListener('submit', createRoomHandler);
  els.joinForm.addEventListener('submit', joinRoomHandler);
  els.copyInviteButton.addEventListener('click', copyInvite);
  els.roomToolsCloseButton.addEventListener('click', closeRoomTools);
  els.roomToolsBackdrop.addEventListener('click', closeRoomTools);
  els.roomInviteCopyLinkButton.addEventListener('click', copyRoomLink);
  els.roomInviteCopyCodeButton.addEventListener('click', copyRoomCode);
  els.roomInviteCopyPasswordButton.addEventListener('click', copyRoomPassword);
  els.roomInviteCopyTextButton.addEventListener('click', copyInviteText);
  els.roomSettingsForm.addEventListener('submit', saveRoomSettings);
  els.roomZipButton.addEventListener('click', () => {
    const url = roomZipUrl();
    if (url) {
      window.location.href = url;
    }
  });
  els.fileSearchInput.addEventListener('input', () => {
    state.fileSearchQuery = normalizeSearchQuery(els.fileSearchInput.value);
    if (state.room) {
      renderRoom(state.room);
    }
  });
  els.fileSearchClearButton.addEventListener('click', () => {
    state.fileSearchQuery = '';
    els.fileSearchInput.value = '';
    if (state.room) {
      renderRoom(state.room);
    } else {
      els.fileSearchSummary.textContent = 'Search across uploaded files, folders, uploaders, and file types.';
    }
    els.fileSearchInput.focus();
  });
  els.togglePasswordButton.addEventListener('click', () => {
    state.passwordVisible = !state.passwordVisible;
    if (state.room) {
      renderRoom(state.room);
    }
  });
  els.leaveButton.addEventListener('click', leaveRoom);
  els.messageForm.addEventListener('submit', sendMessage);
  els.messageInput.addEventListener('input', () => autoGrowTextarea(els.messageInput));
  els.messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!els.messageForm.querySelector('button').disabled) {
        els.messageForm.requestSubmit();
      }
    }
  });

  els.pickFilesButton.addEventListener('click', () => els.fileInput.click());
  els.pickFolderButton.addEventListener('click', () => els.folderInput.click());

  els.fileInput.addEventListener('change', () => {
    if (els.fileInput.files?.length) {
      addUploadItems([...els.fileInput.files]);
      els.fileInput.value = '';
    }
  });

  els.folderInput.addEventListener('change', () => {
    if (els.folderInput.files?.length) {
      addUploadItems([...els.folderInput.files]);
      els.folderInput.value = '';
    }
  });

  els.dropZone.addEventListener('dragenter', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  els.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropZone.classList.add('dragover');
  });
  els.dropZone.addEventListener('dragleave', () => {
    els.dropZone.classList.remove('dragover');
  });
  els.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropZone.classList.remove('dragover');
    const files = [...(event.dataTransfer?.files || [])];
    if (files.length) {
      addUploadItems(files);
    }
  });

  els.resumeButton.addEventListener('click', () => {
    if (state.session) {
      rejoinSavedSession();
    }
  });

  els.clearResumeButton.addEventListener('click', () => {
    disconnectSocket(true);
    showLanding();
    toast('Room details cleared. You will need to join again.', 'success');
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.roomToolsOpen) {
      closeRoomTools();
    }
  });
}

async function createRoomHandler(event) {
  event.preventDefault();
  setBusy(els.createSubmit, true, 'Creating...');

  try {
    const payload = {
      roomName: els.createRoomName.value.trim(),
      hostName: els.createHostName.value.trim(),
      password: els.createPassword.value
    };

    const data = await postJson('/api/rooms', payload);
    const session = {
      roomCode: data.room.id,
      roomName: data.room.name,
      password: payload.password,
      displayName: payload.hostName,
      token: data.session.token,
      memberId: data.session.memberId
    };

    beginSession(session, data.room);
    toast(`Created room ${data.room.id}.`, 'success');
  } catch (error) {
    toast(error.message || 'Unable to create the room.', 'error');
  } finally {
    setBusy(els.createSubmit, false);
  }
}

async function joinRoomHandler(event) {
  event.preventDefault();
  setBusy(els.joinSubmit, true, 'Joining...');

  try {
    const roomCode = els.joinRoomCode.value.trim().toUpperCase();
    const payload = {
      name: els.joinName.value.trim(),
      password: els.joinPassword.value
    };

    const data = await postJson(`/api/rooms/${encodeURIComponent(roomCode)}/join`, payload);
    const session = {
      roomCode: data.room.id,
      roomName: data.room.name,
      password: payload.password,
      displayName: payload.name,
      token: data.session.token,
      memberId: data.session.memberId
    };

    beginSession(session, data.room);
  } catch (error) {
    toast(error.message || 'Unable to join the room.', 'error');
  } finally {
    setBusy(els.joinSubmit, false);
  }
}

function init() {
  wireEvents();
  els.createForm.reset();
  els.joinForm.reset();
  applyInviteParams();
  refreshResumeCard();
  setFormValuesFromSession();
  renderLandingState();
  closeRoomTools();
}

init();

function renderUploadQueue() {
  els.uploadQueue.innerHTML = '';

  if (!state.uploadQueue.length) {
    return;
  }

  for (const item of state.uploadQueue) {
    const card = document.createElement('article');
    card.className = 'upload-card';

    const meta = document.createElement('div');
    meta.className = 'upload-meta';

    const title = document.createElement('strong');
    title.textContent = item.relativePath;

    const subtitle = document.createElement('span');
    subtitle.textContent = `${formatBytes(item.file.size)} - ${item.status}`;

    meta.append(title, subtitle);

    const bar = document.createElement('div');
    bar.className = 'upload-bar';
    const fill = document.createElement('span');
    fill.style.width = `${item.progress}%`;
    bar.appendChild(fill);

    const stateLine = document.createElement('div');
    stateLine.className = 'upload-state';
    stateLine.textContent = item.message || item.status;

    card.append(meta, bar, stateLine);
    els.uploadQueue.appendChild(card);
  }
}
