const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const qrcode = require('qrcode-terminal');
const path = require('path');
require('dotenv').config();

// Initialize Express App for Render Web Service
const app = express();
const PORT = process.env.PORT || 3000;

let waSocket = null;
let isConnected = false;
const cooldownMap = new Map(); // Stores senderJid -> lastReplyTimestamp

// Helper to escape HTML for Telegram
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Telegram Notification Sender
async function sendToTelegram({ name, number, message, profilePicUrl }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error('⚠️ [Telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing in environment variables!');
    return;
  }

  const timeString = new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const htmlContent = `<b>🔔 Naya WhatsApp Message Aaya Hai!</b>\n\n` +
                      `👤 <b>Naam:</b> ${escapeHtml(name)}\n` +
                      `📱 <b>Number:</b> +${escapeHtml(number)}\n` +
                      `💬 <b>Message:</b>\n${escapeHtml(message)}\n\n` +
                      `⏰ <b>Waqt:</b> ${escapeHtml(timeString)}`;

  try {
    if (profilePicUrl) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
          chat_id: chatId,
          photo: profilePicUrl,
          caption: htmlContent,
          parse_mode: 'HTML'
        });
        console.log(`✅ [Telegram] Photo notification successfully sent for +${number} (${name})`);
        return;
      } catch (photoErr) {
        console.warn(`⚠️ [Telegram] sendPhoto failed, falling back to sendMessage: ${photoErr.message}`);
      }
    }

    // Fallback or text-only message
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: htmlContent,
      parse_mode: 'HTML'
    });
    console.log(`✅ [Telegram] Text notification successfully sent for +${number} (${name})`);
  } catch (err) {
    console.error('❌ [Telegram] Error sending message:', err.response?.data || err.message);
  }
}

// Function to start WhatsApp Client via Baileys
async function startWhatsApp() {
  const authDir = path.join(__dirname, 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const { version, isLatest } = await fetchLatestBaileysVersion();

  console.log(`Using Baileys version v${version.join('.')}, isLatest: ${isLatest}`);

  waSocket = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  // Pairing code feature for headless cloud platforms like Render
  if (!waSocket.authState.creds.registered && process.env.PHONE_NUMBER) {
    const rawNumber = process.env.PHONE_NUMBER.replace(/[^0-9]/g, '');
    console.log(`\n⏳ Requesting 8-digit Pairing Code for phone number: +${rawNumber}...`);
    setTimeout(async () => {
      try {
        const code = await waSocket.requestPairingCode(rawNumber);
        console.log('\n' + '='.repeat(50));
        console.log(`🔥 YOUR WHATSAPP PAIRING CODE: ${code}`);
        console.log('='.repeat(50));
        console.log('👉 WhatsApp open karein -> Linked Devices -> "Link with phone number instead"');
        console.log(`👉 Yeh 8-digit code daalein: ${code}\n`);
      } catch (err) {
        console.error('❌ Failed to get pairing code:', err.message);
      }
    }, 4000);
  }

  // Connection Update Event
  waSocket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !process.env.PHONE_NUMBER) {
      console.log('\n📲 QR Code received (scan if viewing in terminal):');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('⚠️ WhatsApp connection closed. Reconnecting:', shouldReconnect);

      if (shouldReconnect) {
        setTimeout(startWhatsApp, 3000);
      } else {
        console.log('❌ Device logged out. Please delete auth_info_baileys and restart.');
      }
    } else if (connection === 'open') {
      isConnected = true;
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
        <p>Uptime: ${Math.floor(process.uptime())} seconds</p>
      </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsappConnected: isConnected,
    uptimeSeconds: Math.floor(process.uptime())
  });
});

// Start Web Server and WhatsApp Bot
app.listen(PORT, () => {
  console.log(`🌐 Express web server running on port ${PORT}`);
  startWhatsApp();
});
