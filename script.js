// ================= STATE =================
const state = {
    apiKey: '',
    model: 'gemini-1.5-flash-latest',
    role: 'friend',
    callSign: 'Kamu',
    aiName: 'Gemini AI',
    phoneNumber: '',
    avatarDataUrl: '',
    messageHistory: [],
    maxHistory: 10,
    isTyping: false,
    isOnline: navigator.onLine,
    configSaved: false,
    pendingAttachment: null  // { fileName, base64, mimeType, size }
};

const OBF_KEY = 'WaAiChatV1_2026';
const LS_KEY = 'wa_ai_config';
const LS_HISTORY = 'wa_ai_history';

// ================= AUDIO ENGINE =================
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playIncomingSound() {
    ensureAudio();
    const t = audioCtx.currentTime;
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc1.connect(gain); osc2.connect(gain); gain.connect(audioCtx.destination);
    osc1.type = 'sine'; osc2.type = 'sine';
    osc1.frequency.setValueAtTime(1200, t);
    osc1.frequency.exponentialRampToValueAtTime(800, t + 0.12);
    osc2.frequency.setValueAtTime(1600, t);
    osc2.frequency.exponentialRampToValueAtTime(1200, t + 0.1);
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    osc1.start(t); osc2.start(t);
    osc1.stop(t + 0.35); osc2.stop(t + 0.35);
}

function playOutgoingSound() {
    ensureAudio();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const filter = audioCtx.createBiquadFilter();
    osc.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'triangle'; filter.type = 'lowpass';
    osc.frequency.setValueAtTime(600, t);
    osc.frequency.exponentialRampToValueAtTime(300, t + 0.15);
    filter.frequency.setValueAtTime(2000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.2);
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t); osc.stop(t + 0.25);
}

function playErrorSound() {
    ensureAudio();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.linearRampToValueAtTime(100, t + 0.3);
    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    osc.start(t); osc.stop(t + 0.3);
}

// ================= UTILITIES =================
function toast(msg, type) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast ' + (type || '');
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (!url) return '#';
    const allowed = ['http:', 'https:', 'mailto:', 'tel:'];
    try {
        const parsed = new URL(url, window.location.href);
        if (!allowed.includes(parsed.protocol)) return '#';
        return parsed.href;
    } catch {
        return '#';
    }
}

function parseMarkdown(text) {
    const codeBlocks = [];
    let html = text.replace(/```([\s\S]*?)```/g, (match, code) => {
        codeBlocks.push(escapeHtml(code));
        return '\x00BLOCK' + (codeBlocks.length - 1) + '\x00';
    });

    const inlineCodes = [];
    html = html.replace(/`([^`]+)`/g, (match, code) => {
        inlineCodes.push(escapeHtml(code));
        return '\x00INLINE' + (inlineCodes.length - 1) + '\x00';
    });

    html = escapeHtml(html);
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    html = html.replace(/\*(.+?)\*/g, '<i>$1</i>');
    html = html.replace(/~~(.+?)~~/g, '<s>$1</s>');
    html = html.replace(/(https?:\/\/[^\s&lt;]+)/g, (match) => {
        const safe = sanitizeUrl(match);
        return '<a href="' + safe + '" target="_blank" rel="noopener noreferrer">' + match + '</a>';
    });

    html = html.replace(/\x00INLINE(\d+)\x00/g, (match, idx) => {
        return '<code>' + inlineCodes[idx] + '</code>';
    });

    html = html.replace(/\x00BLOCK(\d+)\x00/g, (match, idx) => {
        return '<pre><code>' + codeBlocks[idx] + '</code></pre>';
    });

    html = html.replace(/\n/g, '<br>');

    const whitelist = ['BR','B','I','S','CODE','PRE','A','STRONG','EM'];
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    function cleanNode(node) {
        if (node.nodeType === 3) return;
        if (node.nodeType === 1) {
            const tag = node.nodeName;
            if (!whitelist.includes(tag)) {
                const parent = node.parentNode;
                while (node.firstChild) {
                    parent.insertBefore(node.firstChild, node);
                }
                parent.removeChild(node);
            } else {
                if (tag === 'A') {
                    const href = node.getAttribute('href') || '#';
                    node.setAttribute('href', sanitizeUrl(href));
                    node.setAttribute('rel', 'noopener noreferrer');
                    node.setAttribute('target', '_blank');
                    for (let i = node.attributes.length - 1; i >= 0; i--) {
                        const attr = node.attributes[i].name;
                        if (!['href','rel','target'].includes(attr)) {
                            node.removeAttribute(attr);
                        }
                    }
                } else {
                    while (node.attributes.length > 0) {
                        node.removeAttribute(node.attributes[0].name);
                    }
                }
                Array.from(node.childNodes).forEach(cleanNode);
            }
        }
    }
    Array.from(tmp.childNodes).forEach(cleanNode);
    return tmp.innerHTML;
}

function formatTime(date) {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function getDateLabel(date) {
    const now = new Date();
    const d = new Date(date);
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    if (isToday) return 'Hari ini';
    if (isYesterday) return 'Kemarin';
    return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// ================= OBFUSCATION & STORAGE =================
function obfuscate(str) {
    let res = '';
    for (let i = 0; i < str.length; i++) {
        res += String.fromCharCode(str.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
    }
    return btoa(res);
}

function deobfuscate(str) {
    try {
        const decoded = atob(str);
        let res = '';
        for (let i = 0; i < decoded.length; i++) {
            res += String.fromCharCode(decoded.charCodeAt(i) ^ OBF_KEY.charCodeAt(i % OBF_KEY.length));
        }
        return res;
    } catch { return ''; }
}

function saveConfig(config) {
    const data = {
        apiKey: obfuscate(config.apiKey),
        model: config.model,
        role: config.role,
        callSign: config.callSign,
        aiName: config.aiName,
        phoneNumber: config.phoneNumber,
        avatar: config.avatar,
        expiry: config.expiry,
        savedAt: Date.now()
    };
    localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function loadConfig() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data.expiry && data.expiry > 0 && Date.now() > data.expiry) {
            localStorage.removeItem(LS_KEY);
            localStorage.removeItem(LS_HISTORY);
            return null;
        }
        return {
            apiKey: deobfuscate(data.apiKey),
            model: data.model || 'gemini-1.5-flash-latest',
            role: data.role || 'friend',
            callSign: data.callSign || 'Kamu',
            aiName: data.aiName || 'Gemini AI',
            phoneNumber: data.phoneNumber || '',
            avatar: data.avatar || ''
        };
    } catch { return null; }
}

function saveHistory() {
    localStorage.setItem(LS_HISTORY, JSON.stringify(state.messageHistory));
}

function loadHistory() {
    try {
        const raw = localStorage.getItem(LS_HISTORY);
        if (raw) state.messageHistory = JSON.parse(raw);
    } catch {}
}

// ================= ATTACHMENT PREVIEW =================
function showAttachmentPreview(att) {
    removeAttachmentPreview();
    const chip = document.createElement('div');
    chip.id = 'attach-preview';
    chip.style.cssText = `
        display: flex; align-items: center; gap: 8px; padding: 6px 10px;
        background: #e1f3e1; border-radius: 20px; margin: 0 10px 4px;
        font-size: 13px; position: relative;
    `;
    chip.innerHTML = `
        <span>📎 ${escapeHtml(att.fileName)} (${formatFileSize(att.size)})</span>
        <span onclick="removeAttachmentPreview()" style="cursor:pointer; margin-left:auto; color:#e74c3c;">✕</span>
    `;
    document.querySelector('.chat-input-area').prepend(chip);
}

function removeAttachmentPreview() {
    const old = document.getElementById('attach-preview');
    if (old) old.remove();
    state.pendingAttachment = null;
}

// ================= MENU & PANEL LOGIC =================
function toggleDropdown(e) {
    e.stopPropagation();
    const menu = document.getElementById('wa-dropdown');
    const overlay = document.getElementById('wa-overlay');
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
        menu.classList.remove('hidden');
        overlay.classList.remove('hidden');
    } else {
        closeAllMenus();
    }
}

function closeAllMenus() {
    document.getElementById('wa-dropdown').classList.add('hidden');
    closeSettings();
    const overlay = document.getElementById('wa-overlay');
    overlay.classList.add('hidden');
    overlay.style.zIndex = '90';
}

function openSettings() {
    closeAllMenus();
    const panel = document.getElementById('settings-panel');
    const overlay = document.getElementById('wa-overlay');

    document.getElementById('settings-name').value = state.aiName;
    document.getElementById('settings-number').value = state.phoneNumber || generateRandomNumber();
    document.getElementById('settings-model').value = state.model;
    document.getElementById('settings-api-key').value = state.apiKey;
    document.getElementById('settings-call').value = state.callSign;
    document.getElementById('settings-role').value = state.role;

    if (state.avatarDataUrl) {
        document.getElementById('settings-avatar').style.backgroundImage = 'url(' + state.avatarDataUrl + ')';
    }

    panel.classList.remove('hidden');
    overlay.classList.remove('hidden');
    overlay.style.zIndex = '200';
}

function closeSettings() {
    const panel = document.getElementById('settings-panel');
    if (!panel.classList.contains('hidden')) {
        panel.classList.add('closing');
        setTimeout(() => {
            panel.classList.add('hidden');
            panel.classList.remove('closing');
        }, 200);
    }
}

function generateRandomNumber() {
    const prefixes = ['0812','0813','0821','0822','0851','0852','0853','0855','0856','0857','0858','0877','0878','0895','0896','0897','0899'];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = Math.floor(Math.random() * 90000000 + 10000000);
    const s = suffix.toString();
    return prefix + '-' + s.slice(0,4) + '-' + s.slice(4,8);
}

function randomizeNumber() {
    document.getElementById('settings-number').value = generateRandomNumber();
}

document.getElementById('settings-avatar-input').addEventListener('change', function(e) {
    if (!e.target.files[0]) return;
    const reader = new FileReader();
    reader.onload = () => {
        state.avatarDataUrl = reader.result;
        document.getElementById('settings-avatar').style.backgroundImage = 'url(' + reader.result + ')';
        document.getElementById('display-avatar').style.backgroundImage = 'url(' + reader.result + ')';
    };
    reader.readAsDataURL(e.target.files[0]);
});

function saveSettings() {
    const name = document.getElementById('settings-name').value.trim() || 'Gemini AI';
    const key = document.getElementById('settings-api-key').value.trim();
    const model = document.getElementById('settings-model').value.trim() || 'gemini-1.5-flash-latest';
    const days = parseInt(document.getElementById('settings-expiry').value);
    const phone = document.getElementById('settings-number').value.trim();

    if (!key) {
        toast('API Key wajib diisi!', 'error');
        return;
    }

    state.apiKey = key;
    state.model = model;
    state.aiName = name;
    state.phoneNumber = phone;
    state.role = document.getElementById('settings-role').value;
    state.callSign = document.getElementById('settings-call').value;
    state.configSaved = true;

    const expiry = days > 0 ? Date.now() + (days * 24 * 60 * 60 * 1000) : 0;
    saveConfig({
        apiKey: key,
        model: model,
        role: state.role,
        callSign: state.callSign,
        aiName: name,
        phoneNumber: phone,
        avatar: state.avatarDataUrl,
        expiry: expiry
    });

    document.getElementById('display-name').textContent = name;
    closeAllMenus();
    toast('Pengaturan tersimpan');
}

// ================= CHAT UI =================
function initChat() {
    document.getElementById('display-name').textContent = state.aiName;
    if (state.avatarDataUrl) {
        document.getElementById('display-avatar').style.backgroundImage = 'url(' + state.avatarDataUrl + ')';
    }
    loadHistory();
    renderHistory();
    scrollToBottom(false);
    setTimeout(() => document.getElementById('user-input').focus(), 300);

    if (!state.apiKey) {
        toast('Atur API Key di menu titik 3 untuk mulai chat dengan AI', 'error');
    }
}

function renderHistory() {
    const win = document.getElementById('chat-window');
    const systemMsg = win.querySelector('#system-msg');
    win.innerHTML = '';
    if (systemMsg) win.appendChild(systemMsg);

    let lastDate = null;
    state.messageHistory.forEach(msg => {
        const d = new Date(msg.time);
        const dateLabel = getDateLabel(d);
        if (dateLabel !== lastDate) {
            addDateSeparator(dateLabel, false);
            lastDate = dateLabel;
        }
        // History hanya menampilkan teks biasa (tanpa attachment)
        renderBubble(msg.text, msg.role === 'user' ? 'user' : 'ai', new Date(msg.time), msg.role === 'user', false);
    });
}

function addDateSeparator(label, animate) {
    const win = document.getElementById('chat-window');
    const sep = document.createElement('div');
    sep.className = 'date-separator';
    sep.innerHTML = '<span>' + escapeHtml(label) + '</span>';
    win.appendChild(sep);
    if (!animate) {
        sep.style.animation = 'none';
    }
}

function renderBubble(text, sender, time, isRead, animate) {
    const win = document.getElementById('chat-window');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ' + sender;
    if (!animate) bubble.style.animation = 'none';

    const content = document.createElement('div');
    content.className = 'bubble-content';
    content.innerHTML = parseMarkdown(text);
    bubble.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.innerHTML = '<span>' + formatTime(time) + '</span>';

    if (sender === 'user') {
        const statusClass = isRead ? 'read' : 'delivered';
        meta.innerHTML += '<span class="checkmarks ' + statusClass + '"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 8.5l2.5 2.5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 8.5l2.5 2.5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    }

    bubble.appendChild(meta);
    win.appendChild(bubble);
    return bubble;
}

function renderBubbleWithAttachment(text, att, time) {
    const win = document.getElementById('chat-window');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble user';
    const content = document.createElement('div');
    content.className = 'bubble-content';

    let html = '';
    if (att.mimeType.startsWith('image/')) {
        html += `<img src="data:${att.mimeType};base64,${att.base64}" class="bubble-image" onclick="window.open(this.src)">`;
    } else if (att.mimeType.startsWith('video/')) {
        html += `<video src="data:${att.mimeType};base64,${att.base64}" class="bubble-video" controls preload="metadata"></video>`;
    } else if (att.mimeType.startsWith('audio/')) {
        html += `<div class="bubble-audio"><div class="audio-play-btn" onclick="this.nextElementSibling.play()">▶</div><audio src="data:${att.mimeType};base64,${att.base64}" style="display:none"></audio><div class="audio-waveform">${Array(20).fill(0).map(() => '<span style="height:' + (Math.random() * 16 + 4) + 'px"></span>').join('')}</div><span style="font-size:11px;color:var(--wa-meta);">0:00</span></div>`;
    } else {
        html += `<div class="bubble-file"><div class="file-icon">📄</div><div class="file-info"><div class="file-name">${escapeHtml(att.fileName)}</div><div class="file-size">${formatFileSize(att.size)}</div></div></div>`;
    }
    if (text) {
        html += `<div style="margin-top:4px">${parseMarkdown(text)}</div>`;
    }
    content.innerHTML = html;
    bubble.appendChild(content);

    const meta = document.createElement('div');
    meta.className = 'bubble-meta';
    meta.innerHTML = `<span>${formatTime(time)}</span><span class="checkmarks delivered"><svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 8.5l2.5 2.5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg><svg viewBox="0 0 16 16" fill="currentColor"><path d="M2.5 8.5l2.5 2.5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    bubble.appendChild(meta);
    win.appendChild(bubble);
    return bubble;
}

function scrollToBottom(smooth) {
    const win = document.getElementById('chat-window');
    win.scrollTo({
        top: win.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
    });
}

function showTyping() {
    if (state.isTyping) return;
    state.isTyping = true;

    const status = document.getElementById('display-status');
    status.textContent = 'mengetik...';
    status.classList.add('typing');

    const win = document.getElementById('chat-window');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble ai typing-indicator';
    bubble.id = 'typing-bubble';
    bubble.innerHTML = '<div class="typing-dots"><span></span><span></span><span></span></div>';
    win.appendChild(bubble);
    scrollToBottom(true);
}

function hideTyping() {
    if (!state.isTyping) return;
    state.isTyping = false;

    const status = document.getElementById('display-status');
    status.textContent = state.isOnline ? 'Online' : 'Waiting for network...';
    status.classList.remove('typing');
    if (!state.isOnline) status.classList.add('offline');

    const bubble = document.getElementById('typing-bubble');
    if (bubble) bubble.remove();
}

// ================= SEND / RECEIVE =================
async function sendMessage() {
    const input = document.getElementById('user-input');
    const text = input.value.trim();
    const att = state.pendingAttachment;

    if (!text && !att) return;

    ensureAudio();
    playOutgoingSound();

    input.value = '';
    toggleSendIcon();

    const now = new Date();
    addDateSeparatorIfNeeded(now);

    // Tampilkan bubble user
    if (att) {
        renderBubbleWithAttachment(text, att, now);
        // Simpan ke history hanya teks (attachment terlalu besar untuk history)
        state.messageHistory.push({
            role: 'user',
            text: text || '(file: ' + att.fileName + ')',
            time: now.toISOString()
        });
        removeAttachmentPreview();
    } else {
        renderBubble(text, 'user', now, false, true);
        state.messageHistory.push({ role: 'user', text: text, time: now.toISOString() });
    }

    if (state.messageHistory.length > state.maxHistory) state.messageHistory.shift();
    saveHistory();
    scrollToBottom(true);

    showTyping();

    try {
        let response;
        if (att) {
            response = await fetchGemini(text || 'Tolong analisis file ini.', att);
        } else {
            response = await fetchGemini(text);
        }

        hideTyping();
        playIncomingSound();

        const respTime = new Date();
        // Split respons menjadi paragraf dan tampilkan bertahap
        await displayParagraphBubbles(response, respTime);

        // Update centang terkirim ke terbaca
        updateLastUserMessageToRead();

    } catch (err) {
        hideTyping();
        playErrorSound();
        toast('Gagal mendapatkan respon: ' + err.message, 'error');
        console.error(err);
    }
}

function addDateSeparatorIfNeeded(time) {
    const win = document.getElementById('chat-window');
    const separators = win.querySelectorAll('.date-separator');
    const label = getDateLabel(time);
    if (separators.length === 0) {
        if (label !== 'Hari ini') addDateSeparator(label, true);
        return;
    }
    const lastSep = separators[separators.length - 1];
    const lastLabel = lastSep.querySelector('span').textContent;
    if (lastLabel !== label) addDateSeparator(label, true);
}

function updateLastUserMessageToRead() {
    const win = document.getElementById('chat-window');
    const userBubbles = win.querySelectorAll('.chat-bubble.user');
    if (userBubbles.length > 0) {
        const last = userBubbles[userBubbles.length - 1];
        const checkmarks = last.querySelector('.checkmarks');
        if (checkmarks) {
            checkmarks.classList.remove('delivered');
            checkmarks.classList.add('read');
        }
    }
}

// ================= GEMINI API =================
async function fetchGemini(userText, attachment = null) {
    const roles = {
        coding: `Kamu adalah senior developer & software architect. Gaya bicara santai seperti teman tapi sangat ahli secara teknikal. Panggil user "${state.callSign}" secara natural (tidak setiap kalimat). Fokus pada solusi efisien dan bersih.`,
        writing: `Kamu adalah penulis kreatif profesional. Gaya bicara hangat seperti sedang ngobrol di kafe. Panggil user "${state.callSign}" secara natural. Bantu brainstorm ide dan editing dengan kualitas tinggi.`,
        consultant: `Kamu adalah konsultan strategi bisnis dan produktivitas. Gaya bicara lugas, cerdas, tapi tetap bersahabat. Panggil user "${state.callSign}" untuk memberikan insight yang actionable.`,
        friend: `Kamu adalah teman ngobrol yang asik, suportif, dan punya selera humor. Panggil user "${state.callSign}" seperti sahabat karib. Jadilah pendengar yang baik dan teman diskusi yang seru.`
    };

    const systemPrompt = (roles[state.role] || roles.friend) + 
                         ` Selalu jawab dalam Bahasa Indonesia yang natural. Nama kamu adalah ${state.aiName}.`;

    // Konversi history ke format API (hanya teks, tanpa attachment)
    const contents = state.messageHistory.map(msg => ({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: [{ text: msg.text }]
    }));

    // Tambahkan pesan terbaru
    if (attachment) {
        // Pesan user dengan attachment
        const parts = [{ text: userText }];
        if (attachment.mimeType.startsWith('image/') || attachment.mimeType.startsWith('audio/') || attachment.mimeType.startsWith('video/')) {
            parts.push({
                inlineData: {
                    mimeType: attachment.mimeType,
                    data: attachment.base64
                }
            });
        }
        contents.push({ role: 'user', parts: parts });
    } else {
        contents.push({ role: 'user', parts: [{ text: userText }] });
    }

    let fullText = '';
    let attempts = 0;
    const maxAttempts = 3;

    do {
        const payload = {
            contents: contents,
            systemInstruction: { parts: [{ text: systemPrompt }] },
            generationConfig: {
                temperature: 0.8,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 4096
            }
        };

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${state.model}:generateContent?key=${state.apiKey}`;

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error?.message || `Error ${res.status}`);
        }

        const data = await res.json();
        
        if (data.promptFeedback?.blockReason) {
            throw new Error(`Maaf, permintaan diblokir: ${data.promptFeedback.blockReason}`);
        }

        const candidate = data.candidates?.[0];
        if (!candidate) throw new Error('AI tidak memberikan respon.');

        const finishReason = candidate.finishReason;
        const chunk = candidate.content?.parts?.[0]?.text || '';
        
        fullText += chunk;

        if (finishReason === 'SAFETY') {
            fullText += '\n\n_[Respon terhenti demi keamanan]_';
            break;
        } 
        if (finishReason === 'RECITATION') {
            fullText += '\n\n_[Respon terhenti karena masalah hak cipta]_';
            break;
        }
        if (finishReason === 'MAX_TOKENS' && attempts < maxAttempts) {
            attempts++;
            contents.push({ role: 'model', parts: [{ text: chunk }] });
            contents.push({ role: 'user', parts: [{ text: 'Lanjutkan tepat dari kata terakhir tanpa mengulang.' }] });
            continue;
        }
        break;
    } while (true);

    return fullText || 'Maaf, aku bingung mau jawab apa.';
}

// ================= PARAGRAPH BUBBLES DISPLAY =================
function splitIntoParagraphs(text) {
    // Pisahkan berdasarkan double newline, lalu filter kosong, trim
    return text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 0);
}

async function displayParagraphBubbles(fullText, startTime) {
    const paragraphs = splitIntoParagraphs(fullText);
    if (paragraphs.length === 0) return;

    let cumulativeDelay = 0;
    for (let i = 0; i < paragraphs.length; i++) {
        await new Promise(resolve => {
            setTimeout(() => {
                const bubbleTime = new Date(startTime.getTime() + cumulativeDelay);
                addDateSeparatorIfNeeded(bubbleTime);
                renderBubble(paragraphs[i], 'ai', bubbleTime, true, true);
                scrollToBottom(true);
                resolve();
            }, cumulativeDelay);
        });
        if (i === 0) {
            // Bubble pertama langsung (delay 0)
            cumulativeDelay += 0;
        } else {
            // Berikutnya: 300ms, lalu 400ms, 500ms, ... (mulai dari 300 untuk i=1)
            cumulativeDelay += 300 + (i - 1) * 100;
        }
    }
}

// ================= EVENT LISTENERS =================
const userInput = document.getElementById('user-input');
const btnSend = document.getElementById('btn-send');
const iconMic = document.getElementById('icon-mic');
const iconSend = document.getElementById('icon-send');

function toggleSendIcon() {
    const hasText = userInput.value.trim().length > 0;
    const hasAtt = state.pendingAttachment !== null;
    if (hasText || hasAtt) {
        iconMic.classList.add('hidden');
        iconSend.classList.remove('hidden');
    } else {
        iconMic.classList.remove('hidden');
        iconSend.classList.add('hidden');
    }
}

userInput.addEventListener('input', toggleSendIcon);
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!state.apiKey) {
            toast('Atur API Key di Pengaturan dulu, Bro', 'error');
            return;
        }
        sendMessage();
    }
});

btnSend.addEventListener('click', () => {
    if (userInput.value.trim().length > 0 || state.pendingAttachment) {
        if (!state.apiKey) {
            toast('Atur API Key di Pengaturan dulu, Bro', 'error');
            return;
        }
        sendMessage();
    } else {
        startVoiceRecording();
    }
});

window.addEventListener('online', () => {
    state.isOnline = true;
    const status = document.getElementById('display-status');
    if (!state.isTyping) {
        status.textContent = 'Online';
        status.classList.remove('offline');
    }
    toast('Koneksi internet tersambung');
});

window.addEventListener('offline', () => {
    state.isOnline = false;
    const status = document.getElementById('display-status');
    if (!state.isTyping) {
        status.textContent = 'Waiting for network...';
        status.classList.add('offline');
    }
    toast('Koneksi internet terputus', 'error');
});

document.addEventListener('click', (e) => {
    const menu = document.getElementById('wa-dropdown');
    const panel = document.getElementById('settings-panel');
    if (!menu.contains(e.target) && !e.target.closest('[title="Menu"]')) {
        if (!panel.classList.contains('hidden')) return;
        closeAllMenus();
    }
});

function clearChat() {
    closeAllMenus();
    if (confirm('Hapus semua pesan?')) {
        state.messageHistory = [];
        localStorage.removeItem(LS_HISTORY);
        const win = document.getElementById('chat-window');
        const systemMsg = win.querySelector('#system-msg');
        win.innerHTML = '';
        if (systemMsg) win.appendChild(systemMsg);
        toast('Chat dihapus');
    }
}

// ================= ATTACHMENT & MEDIA =================
let attachPanelOpen = false;

function toggleAttachPanel() {
    const panel = document.getElementById('attach-panel');
    attachPanelOpen = !attachPanelOpen;
    if (attachPanelOpen) {
        panel.classList.remove('hidden');
    } else {
        panel.classList.add('hidden');
    }
}

// Close attach panel when clicking outside
document.addEventListener('click', (e) => {
    const panel = document.getElementById('attach-panel');
    const attachIcon = document.querySelector('[title="Attach"]');
    if (attachPanelOpen && !panel.contains(e.target) && !attachIcon.contains(e.target)) {
        panel.classList.add('hidden');
        attachPanelOpen = false;
    }
});

document.querySelector('[title="Attach"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAttachPanel();
});

document.querySelector('[title="Camera"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    triggerCamera();
});

document.querySelector('[title="Emoji"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleEmojiPicker();  
});

function triggerFileInput(accept) {
    const input = document.getElementById('file-input');
    input.accept = accept;
    input.click();
    document.getElementById('attach-panel').classList.add('hidden');
    attachPanelOpen = false;
}

function triggerCamera() {
    document.getElementById('camera-input').click();
    document.getElementById('attach-panel').classList.add('hidden');
    attachPanelOpen = false;
}

async function handleFileSelect(input) {
    const file = input.files[0];
    if (!file) return;
    input.value = ''; // reset

    if (file.size > 20 * 1024 * 1024) {
        toast('File terlalu besar (max 20MB)', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        const mimeType = file.type || 'application/octet-stream';

        state.pendingAttachment = {
            fileName: file.name,
            base64: base64,
            mimeType: mimeType,
            size: file.size
        };

        showAttachmentPreview(state.pendingAttachment);
    };
    reader.readAsDataURL(file);
}

// ================= VOICE RECORDING =================
let mediaRecorder = null;
let voiceChunks = [];
let voiceStartTime = null;
let voiceTimerInterval = null;

async function startVoiceRecording() {
    document.getElementById('attach-panel').classList.add('hidden');
    attachPanelOpen = false;
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        voiceChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) voiceChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            const reader = new FileReader();
            reader.onload = async () => {
                const base64 = reader.result.split(',')[1];
                const now = new Date();
                
                addDateSeparatorIfNeeded(now);
                renderBubbleWithAttachment(
                    '', // voice note tanpa teks
                    {
                        fileName: 'Voice Note.webm',
                        size: blob.size,
                        mimeType: 'audio/webm',
                        base64: base64
                    },
                    now
                );
                scrollToBottom(true);
                
                showTyping();
                try {
                    const response = await fetchGemini('Tolong transkrip atau tanggapi voice note ini.', {
                        fileName: 'Voice Note.webm',
                        size: blob.size,
                        mimeType: 'audio/webm',
                        base64: base64
                    });
                    hideTyping();
                    playIncomingSound();
                    
                    const respTime = new Date();
                    await displayParagraphBubbles(response, respTime);
                    updateLastUserMessageToRead();
                    
                } catch (err) {
                    hideTyping();
                    playErrorSound();
                    toast('Gagal menganalisis voice note: ' + err.message, 'error');
                }
            };
            reader.readAsDataURL(blob);
            
            stream.getTracks().forEach(track => track.stop());
        };
        
        mediaRecorder.start();
        voiceStartTime = Date.now();
        document.getElementById('voice-overlay').classList.remove('hidden');
        
        const timerEl = document.getElementById('voice-timer');
        voiceTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - voiceStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
        }, 1000);
        
    } catch (err) {
        toast('Tidak bisa mengakses mikrofon: ' + err.message, 'error');
    }
}

function stopVoiceRecording() {
    if (voiceTimerInterval) {
        clearInterval(voiceTimerInterval);
        voiceTimerInterval = null;
    }
    document.getElementById('voice-overlay').classList.add('hidden');
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

// ================= CONTEXT RESET =================
function resetContext() {
    state.messageHistory = [];
    saveHistory();
    
    const toastEl = document.getElementById('context-toast');
    toastEl.classList.remove('hidden');
    setTimeout(() => toastEl.classList.add('hidden'), 3000);
    
    const now = new Date();
    addDateSeparatorIfNeeded(now);
    const bubble = renderBubble('Konteks percakapan direset. Pesan berikutnya akan dianggap sebagai pesan pertama.', 'system', now, false, true);
    bubble.style.background = 'rgba(225, 245, 254, 0.92)';
    bubble.style.color = '#54656f';
    bubble.style.maxWidth = '90%';
    scrollToBottom(true);
}

// ================= EMOJI PICKER =================
const emojiData = {
    recent: [],
    smileys: ['😀','😃','😄','😁','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','☠️','👽','👾','🤖','🎃','😺','😸','😹','😻','😼','😽','🙀','😿','😾'],
    hands: ['👋🏻', '🤚🏻', '🖐🏻', '✋🏻', '🖖🏻', '👌🏻', '🤏', '✌️', '🤌', '🤟', '🤙', '🤘', '👈', '🖕', '👆🏻', '👉🏻', '☝🏻', '👇🏻', '👍🏻', '👎🏻', '✊🏻', '🤛🏻', '🤜🏻', '👊🏻', '👏🏻', '🙌🏻', '👐🏻', '🤲🏻', '🙏🏻', '✍🏻', '💅', '💪🏻', '🦾', '🦿', '🦵', '🤳🏻', '🦶'],
    animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐽','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🕸','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐈‍⬛','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿','🦔'],
    food: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🍍','🥝','🥥','🥑','🍆','🥔','🥕','🌽','🌶','🥒','🥬','🥦','🧄','🧅','🍄','🥜','🌰','🍞','🥐','🥖','🥨','🥯','🥞','🧇','🧀','🍖','🍗','🥩','🥓','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🥙','🧆','🥚','🍳','🥘','🍲','🥣','🥗','🍿','🧈','🧂','🥫','🍱','🍘','🍙','🍚','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍥','🍡','🍦','🍧','🍨','🍩','🍪','🎂','🍰','🧁','🥧','🍫','🍬','🍭','🍮','🍯','🍼','🥛','☕','🍵','🍶','🍾','🍷','🍸','🍹','🍺','🍻','🥂','🥃','🥤','🧃','🧉','🧊'],
    activities: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛷','⛸','🥌','🎿','⛷','🏂','🪂','🏋️','🤼','🤽','🤾','🌊','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏇','🕴','🏆','🥇','🥈','🥉','🏅','🎖','🏵','🎗','🎫','🎟','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟','🎯','🎳','🎮','🎰','🧩'],
    travel: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩','💺','🛰','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','⛴','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺','🗿','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛱','🏖','🏝','🏜','🌋','⛰','🏔','🗻','🏕','⛺','🏠','🏡','🏘','🏚','🏗','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛','⛪','🕌','🕍','🛕','🕋','⛩','🛤','🛣','🗾','🎑','🏞','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙','🌃','🌌','🌉','🌁'],
    objects: ['⌚','📱','📲','💻','⌨️','🖥','🖨','🖱','🖲','🕹','🗜','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎️','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🪔','🧯','🛢','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🧰','🔧','🔨','⚒','🛠','⛏','🔩','⚙️','🪚','🔫','🏹','🛡','🔪','🗡','⚔️','🪓','🔮','🪄','💈','⚗️','🔭','🔬','🕳','🩹','🩺','💊','💉','🩸','🧬','🦠','🧫','🧪','🌡','🪤','🪒','🪑','🚪','🪞','🪟','🛏','🛋','🪠','🪤','🪣','🪥','🧴','🧷','🧹','🧺','🧻','🧼','🧽','🧯','🛒','🚬','⚰️','🪦','⚱️','🗿','🪧'],
    symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂','🛂','🛃','🛄','🛅','🛗','🧭','🧱','🧸','🧷','🧮','🧾','🧰','🧲','🧪','🧫','🧬','🧯','🧴','🧵','🧶','🧷','🧹','🧺','🧻','🧼','🧽','🧴','🧯']
};

function loadRecentEmojis() {
    try {
        const saved = localStorage.getItem('wa_ai_recent_emojis');
        if (saved) emojiData.recent = JSON.parse(saved);
    } catch {}
}

function saveRecentEmojis() {
    localStorage.setItem('wa_ai_recent_emojis', JSON.stringify(emojiData.recent.slice(0, 30)));
}

let emojiPickerOpen = false;
let currentEmojiCategory = 'recent';

function toggleEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    emojiPickerOpen = !emojiPickerOpen;
    
    if (emojiPickerOpen) {
        document.getElementById('attach-panel').classList.add('hidden');
        attachPanelOpen = false;
        
        loadRecentEmojis();
        renderEmojiGrid(currentEmojiCategory);
        picker.classList.remove('hidden');
        
        setTimeout(() => document.getElementById('emoji-search').focus(), 100);
    } else {
        picker.classList.add('hidden');
    }
}

function renderEmojiGrid(category, searchTerm) {
    const grid = document.getElementById('emoji-grid');
    grid.innerHTML = '';
    
    let emojis = [];
    
    if (searchTerm) {
        Object.keys(emojiData).forEach(cat => {
            if (cat !== 'recent') {
                emojis = emojis.concat(emojiData[cat]);
            }
        });
        emojis = emojis.filter(e => e.includes(searchTerm));
    } else {
        emojis = emojiData[category] || emojiData.smileys;
    }
    
    emojis = [...new Set(emojis)];
    
    emojis.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'emoji-btn';
        btn.textContent = emoji;
        btn.onclick = () => insertEmoji(emoji);
        grid.appendChild(btn);
    });
    
    if (emojis.length === 0) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:20px;color:var(--wa-text-secondary);font-size:14px;">Tidak ada emoji</div>';
    }
}

function insertEmoji(emoji) {
    const input = document.getElementById('user-input');
    const start = input.selectionStart;
    const end = input.selectionEnd;
    const text = input.value;
    
    input.value = text.slice(0, start) + emoji + text.slice(end);
    input.selectionStart = input.selectionEnd = start + emoji.length;
    input.focus();
    
    input.dispatchEvent(new Event('input'));
    
    emojiData.recent = emojiData.recent.filter(e => e !== emoji);
    emojiData.recent.unshift(emoji);
    if (emojiData.recent.length > 30) emojiData.recent.pop();
    saveRecentEmojis();
}

document.querySelectorAll('.emoji-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.emoji-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        currentEmojiCategory = tab.dataset.category;
        renderEmojiGrid(currentEmojiCategory);
    });
});

document.getElementById('emoji-search').addEventListener('input', (e) => {
    const term = e.target.value.trim();
    if (term) {
        renderEmojiGrid(null, term);
    } else {
        renderEmojiGrid(currentEmojiCategory);
    }
});

document.addEventListener('click', (e) => {
    const picker = document.getElementById('emoji-picker');
    const emojiIcon = document.querySelector('[title="Emoji"]');
    if (emojiPickerOpen && !picker.contains(e.target) && !emojiIcon.contains(e.target)) {
        picker.classList.add('hidden');
        emojiPickerOpen = false;
    }
});

// ================= PWA INSTALL PROMPT =================
let deferredPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    // Cegah mini-infobar muncul di mobile Chrome
    e.preventDefault();
    deferredPrompt = e;
    
    // Tampilkan tombol install di UI
    const installBanner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');
    
    if (installBanner) installBanner.classList.remove('hidden');
    if (installBtn) installBtn.classList.remove('hidden');
    
    console.log('📲 PWA install prompt siap ditampilkan');
});

async function installApp() {
    if (!deferredPrompt) {
        toast('Aplikasi sudah terinstal atau browser tidak mendukung', 'info');
        return;
    }
    
    // Tampilkan prompt install native
    deferredPrompt.prompt();
    
    // Tunggu user merespon prompt
    const { outcome } = await deferredPrompt.userChoice;
    console.log(`User response to install prompt: ${outcome}`);
    
    if (outcome === 'accepted') {
        toast('🎉 Aplikasi berhasil diinstal!', 'success');
    } else {
        toast('Instalasi dibatalkan', 'info');
    }
    
    // Reset deferredPrompt
    deferredPrompt = null;
    
    // Sembunyikan tombol install
    const installBanner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');
    
    if (installBanner) installBanner.classList.add('hidden');
    if (installBtn) installBtn.classList.add('hidden');
}

// Tutup banner install
function closeInstallBanner() {
    const installBanner = document.getElementById('install-banner');
    if (installBanner) installBanner.classList.add('hidden');
}

// Event listener untuk tombol install
document.addEventListener('DOMContentLoaded', () => {
    const installBtn = document.getElementById('install-btn');
    const installBannerClose = document.getElementById('install-banner-close');
    
    if (installBtn) {
        installBtn.addEventListener('click', installApp);
    }
    
    if (installBannerClose) {
        installBannerClose.addEventListener('click', closeInstallBanner);
    }
});

// Deteksi apakah sudah terinstal
window.addEventListener('appinstalled', () => {
    console.log('✅ PWA berhasil diinstal');
    deferredPrompt = null;
    
    const installBanner = document.getElementById('install-banner');
    const installBtn = document.getElementById('install-btn');
    
    if (installBanner) installBanner.classList.add('hidden');
    if (installBtn) installBtn.classList.add('hidden');
    
    toast('Aplikasi sudah terinstal di perangkat Anda', 'success');
});

// ================= INIT =================
(function init() {
    const saved = loadConfig();
    if (saved && saved.apiKey) {
        state.apiKey = saved.apiKey;
        state.model = saved.model;
        state.role = saved.role;
        state.callSign = saved.callSign;
        state.aiName = saved.aiName;
        state.phoneNumber = saved.phoneNumber || '';
        state.avatarDataUrl = saved.avatar || '';
        state.configSaved = true;
    }
    initChat();
})();