const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize Express App for Web Service / Uptime Monitoring
const app = express();
const PORT = process.env.PORT || 3000;

let waSocket = null;
let isConnected = false;
let isPairingRequested = false;
let activeChatId = (process.env.TELEGRAM_CHAT_ID || '').trim();
const cooldownMap = new Map(); // Stores senderJid -> lastReplyTimestamp
const authDir = path.join(__dirname, 'auth_info_baileys');

// Helper to escape HTML characters for Telegram formatting
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Function to auto-detect valid Chat ID from Telegram getUpdates
async function fetchLatestChatId(token) {
  try {
    const res = await axios.get(`https://api.telegram.org/bot${token}/getUpdates`);
    const updates = res.data?.result || [];
    for (let i = updates.length - 1; i >= 0; i--) {
      const cid = updates[i]?.message?.chat?.id;
      if (cid) {
        return String(cid);
      }
    }
  } catch (err) {
    console.error('⚠️ [Telegram] Error querying getUpdates:', err.response?.data || err.message);
  }
  return null;
}

// Telegram Notification Sender with auto-detection & recovery
async function sendToTelegram({ name, number, message, profilePicUrl }) {
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();

  if (!token) {
    console.error('⚠️ [Telegram] TELEGRAM_BOT_TOKEN is missing in environment variables!');
    return;
  }

  // If no chat ID set or previous failed, attempt auto-detection from getUpdates
  if (!activeChatId) {
    console.log('🔍 [Telegram] No Chat ID configured. Searching getUpdates for recent conversations...');
    const detectedId = await fetchLatestChatId(token);
    if (detectedId) {
      activeChatId = detectedId;
      console.log(`🎯 [Telegram] Auto-detected Telegram Chat ID: ${activeChatId}`);
    } else {
      console.error('❌ [Telegram] No Chat ID found! Please send a message (e.g. "/start") to your Telegram bot.');
      return;
    }
  }

  const timeString = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const htmlContent = `<b>🔔 New WhatsApp Message Received</b>\n\n` +
                      `👤 <b>Sender:</b> ${escapeHtml(name)}\n` +
                      `📱 <b>Phone:</b> +${escapeHtml(number)}\n` +
                      `💬 <b>Message:</b>\n${escapeHtml(message)}\n\n` +
                      `⏰ <b>Timestamp:</b> ${escapeHtml(timeString)}`;

  const plainTextContent = `🔔 New WhatsApp Message Received\n\n` +
                           `👤 Sender: ${name}\n` +
                           `📱 Phone: +${number}\n` +
                           `💬 Message:\n${message}\n\n` +
                           `⏰ Timestamp: ${timeString}`;

  // Helper to execute sending
  async function attemptSend(targetChatId) {
    if (profilePicUrl) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
          chat_id: targetChatId,
          photo: profilePicUrl,
          caption: htmlContent,
          parse_mode: 'HTML'
        });
        console.log(`✅ [Telegram] Photo notification successfully sent to ${targetChatId} for +${number} (${name})`);
        return true;
      } catch (photoErr) {
        console.warn(`⚠️ [Telegram] sendPhoto failed: ${photoErr.response?.data?.description || photoErr.message}, falling back to text...`);
      }
    }

    try {
      await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
        chat_id: targetChatId,
        text: htmlContent,
        parse_mode: 'HTML'
      });
      console.log(`✅ [Telegram] HTML notification successfully sent to ${targetChatId} for +${number} (${name})`);
      return true;
    } catch (textErr) {
      console.warn(`⚠️ [Telegram] sendMessage with HTML failed: ${textErr.response?.data?.description || textErr.message}, trying plain text...`);
    }

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: targetChatId,
      text: plainTextContent
    });
    console.log(`✅ [Telegram] Plain text notification successfully sent to ${targetChatId} for +${number} (${name})`);
    return true;
  }

  try {
    await attemptSend(activeChatId);
  } catch (err) {
    const errorDesc = err.response?.data?.description || err.message;
    console.error(`❌ [Telegram] Delivery failed to Chat ID ${activeChatId}: ${errorDesc}`);

    // If chat not found, auto-recover by querying getUpdates to find the real user ID
    if (String(errorDesc).includes('chat not found')) {
      console.log('🔄 "chat not found" encountered. Checking getUpdates to auto-discover your real Chat ID...');
      const freshChatId = await fetchLatestChatId(token);

      if (freshChatId && freshChatId !== activeChatId) {
        console.log(`💡 Discovered correct Chat ID: ${freshChatId}. Retrying delivery now...`);
        activeChatId = freshChatId;
        try {
          await attemptSend(activeChatId);
          console.log(`🎉 [Telegram] Successfully recovered and delivered notification to Chat ID: ${activeChatId}`);
        } catch (retryErr) {
          console.error('❌ [Telegram] Retry also failed:', retryErr.response?.data || retryErr.message);
        }
      } else {
        console.log('👉 Tip: Open your Telegram bot and send "/start" or "hi" to register your chat with the bot!');
      }
    }
  }
}

// Function to start WhatsApp Client via Baileys
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`Using Baileys version v${version.join('.')}, isLatest: ${isLatest}`);

  // Query Telegram on boot to warm up activeChatId
  const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (token) {
    fetchLatestChatId(token).then((detected) => {
      if (detected) {
        activeChatId = detected;
        console.log(`📱 [Telegram] Verified active Telegram Chat ID: ${activeChatId}`);
      }
    });
  }

  waSocket = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 25000,
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  // Pairing code feature - only request once to ensure stable code
  const isRegistered = waSocket.authState?.creds?.registered;

  if (!isRegistered && process.env.PHONE_NUMBER && !isPairingRequested) {
    const rawNumber = process.env.PHONE_NUMBER.replace(/[^0-9]/g, '');
    console.log(`\n⏳ Requesting 8-digit Pairing Code for phone number: +${rawNumber}...`);
    
    isPairingRequested = true;

    setTimeout(async () => {
      try {
        if (waSocket.authState?.creds?.registered) return;

        const code = await waSocket.requestPairingCode(rawNumber);
        console.log('\n' + '='.repeat(50));
        console.log(`🔥 YOUR WHATSAPP PAIRING CODE: ${code}`);
        console.log('='.repeat(50));
        console.log('👉 Open WhatsApp on your phone -> Settings -> Linked Devices -> "Link with phone number instead"');
        console.log(`👉 Enter this 8-digit code: ${code}`);
        console.log('👉 (This pairing code is stable; enter it directly on your phone)\n');
      } catch (err) {
        console.error('❌ Failed to get pairing code:', err.message);
        isPairingRequested = false; // Allow retry on fatal failure
      }
    }, 6000);
  }

  // Connection Update Event
  waSocket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    if (qr && !process.env.PHONE_NUMBER) {
      console.log('\n📲 QR Code received (scan if viewing in terminal):');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const isAlreadyRegistered = waSocket?.authState?.creds?.registered;

      console.log(`⚠️ WhatsApp connection closed. Code: ${statusCode || 'unknown'}, Registered: ${Boolean(isAlreadyRegistered)}`);

      // If user explicitly unlinked from phone settings AFTER being registered
      if (isAlreadyRegistered && statusCode === DisconnectReason.loggedOut) {
        console.log('❌ Device was unlinked from WhatsApp. Resetting session...');
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (e) {}
        isPairingRequested = false;
        setTimeout(startWhatsApp, 3000);
        return;
      }

      // During pairing handshake: 515 (restartRequired) or temporary network close is normal
      if (statusCode === DisconnectReason.restartRequired) {
        console.log('🔄 Completing WhatsApp pairing handshake...');
        setTimeout(startWhatsApp, 2000);
        return;
      }

      // Keep connection alive so user has ample time to enter pairing code
      console.log('🔄 Reconnecting to keep pairing session alive...');
      setTimeout(startWhatsApp, 3000);
    } else if (connection === 'open') {
      isConnected = true;
      isPairingRequested = false;
      console.log('\n🚀 WhatsApp successfully connected and ready!');
    }
  });

  // Save authentication credentials whenever updated
  waSocket.ev.on('creds.update', saveCreds);

  // Incoming Messages Event
  waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const m of messages) {
      if (!m.message) continue;
      if (m.key.fromMe) continue; // Ignore messages sent by yourself

      const senderJid = m.key.remoteJid;
      if (!senderJid) continue;

      // Filter: Only 1-on-1 private WhatsApp chats (ignore groups and status updates)
      if (senderJid.endsWith('@g.us') || senderJid === 'status@broadcast') {
        continue;
      }

      const senderNumber = senderJid.replace('@s.whatsapp.net', '');
      const senderName = m.pushName || 'Unknown User';

      // Extract message text / caption / media type
      const msg = m.message;
      let messageContent = '';

      if (msg.conversation) {
        messageContent = msg.conversation;
      } else if (msg.extendedTextMessage?.text) {
        messageContent = msg.extendedTextMessage.text;
      } else if (msg.imageMessage?.caption) {
        messageContent = `📷 [Image] ${msg.imageMessage.caption}`;
      } else if (msg.imageMessage) {
        messageContent = '📷 [Photo / Image]';
      } else if (msg.videoMessage?.caption) {
        messageContent = `🎥 [Video] ${msg.videoMessage.caption}`;
      } else if (msg.videoMessage) {
        messageContent = '🎥 [Video]';
      } else if (msg.audioMessage) {
        messageContent = '🎵 [Voice Note / Audio]';
      } else if (msg.documentMessage) {
        messageContent = `📄 [Document: ${msg.documentMessage.fileName || 'file'}]`;
      } else if (msg.contactMessage || msg.contactsArrayMessage) {
        messageContent = '👤 [Contact Card]';
      } else if (msg.locationMessage) {
        messageContent = '📍 [Location Shared]';
      } else if (msg.stickerMessage) {
        messageContent = '🏷️ [Sticker]';
      } else {
        messageContent = '💬 [Message]';
      }

      console.log(`\n📨 Message from +${senderNumber} (${senderName}): ${messageContent}`);

      // 1. Fetch Profile Picture if available
      let profilePicUrl = null;
      try {
        profilePicUrl = await waSocket.profilePictureUrl(senderJid, 'image');
      } catch (e) {
        // Privacy setting or no profile photo
        profilePicUrl = null;
      }

      // 2. Send Telegram Notification
      await sendToTelegram({
        name: senderName,
        number: senderNumber,
        message: messageContent,
        profilePicUrl: profilePicUrl
      });

      // 3. Send WhatsApp Auto-Reply with cooldown to avoid spamming the sender
      const now = Date.now();
      const cooldownMinutes = parseInt(process.env.COOLDOWN_MINUTES || '15', 10);
      const cooldownMs = cooldownMinutes * 60 * 1000;
      const lastReplyTime = cooldownMap.get(senderJid) || 0;

      if (now - lastReplyTime > cooldownMs) {
        cooldownMap.set(senderJid, now);
        const autoReplyText = process.env.AUTO_REPLY_MESSAGE || "he'll response once he get online.";

        try {
          await waSocket.sendMessage(senderJid, { text: autoReplyText }, { quoted: m });
          console.log(`🤖 [Auto-Reply] Sent to +${senderNumber}: "${autoReplyText}"`);
        } catch (err) {
          console.error(`❌ [Auto-Reply] Failed to send reply to +${senderNumber}:`, err.message);
        }
      } else {
        console.log(`⏳ [Cooldown] Auto-reply skipped for +${senderNumber} (already replied within ${cooldownMinutes}m)`);
      }
    }
  });
}

// Web Server Routes (For Render Keep-Alive / Health Checks)
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>WhatsApp Telegram Bot</title></head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px; background-color: #f7f9fa;">
        <h2>🤖 WhatsApp Auto-Reply & Telegram Bot</h2>
        <p>Status: <b style="color: ${isConnected ? 'green' : 'orange'};">${isConnected ? 'Online & Connected to WhatsApp' : 'Connecting / Disconnected'}</b></p>
        <p>Active Telegram Chat ID: <code>${activeChatId || 'Not detected yet'}</code></p>
        <p>Uptime: ${Math.floor(process.uptime())} seconds</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsappConnected: isConnected,
    telegramChatIdSet: Boolean(activeChatId),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Start Web Server and WhatsApp Bot
app.listen(PORT, () => {
  console.log(`🌐 Express web server running on port ${PORT}`);
  startWhatsApp();
});
