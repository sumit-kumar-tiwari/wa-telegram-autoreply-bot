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
const QRCode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
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
let currentQrDataUrl = null;
let currentPairingCode = null;
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
    console.error('⚠️ [Telegram] Error querying getUpdates:', err.response?.data?.description || err.message);
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

  // If no chat ID set, search getUpdates
  if (!activeChatId) {
    console.log('🔍 [Telegram] Searching getUpdates for active conversations...');
    const detectedId = await fetchLatestChatId(token);
    if (detectedId) {
      activeChatId = detectedId;
      console.log('🎯 [Telegram] Auto-detected Telegram Chat ID successfully');
    } else {
      console.error('❌ [Telegram] No Chat ID found! Please send "/start" to your Telegram bot.');
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

  async function attemptSend(targetChatId) {
    if (profilePicUrl) {
      try {
        await axios.post(`https://api.telegram.org/bot${token}/sendPhoto`, {
          chat_id: targetChatId,
          photo: profilePicUrl,
          caption: htmlContent,
          parse_mode: 'HTML'
        });
        console.log(`✅ [Telegram] Photo notification successfully sent for +${number} (${name})`);
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
      console.log(`✅ [Telegram] HTML notification successfully sent for +${number} (${name})`);
      return true;
    } catch (textErr) {
      console.warn(`⚠️ [Telegram] sendMessage with HTML failed: ${textErr.response?.data?.description || textErr.message}, trying plain text...`);
    }

    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: targetChatId,
      text: plainTextContent
    });
    console.log(`✅ [Telegram] Plain text notification successfully sent for +${number} (${name})`);
    return true;
  }

  try {
    await attemptSend(activeChatId);
  } catch (err) {
    const errorDesc = err.response?.data?.description || err.message;
    console.error(`❌ [Telegram] Delivery failed: ${errorDesc}`);

    if (String(errorDesc).includes('chat not found')) {
      console.log('🔄 "chat not found" encountered. Refreshing getUpdates...');
      const freshChatId = await fetchLatestChatId(token);

      if (freshChatId && freshChatId !== activeChatId) {
        activeChatId = freshChatId;
        try {
          await attemptSend(activeChatId);
          console.log(`🎉 [Telegram] Successfully recovered and delivered notification!`);
        } catch (retryErr) {
          console.error('❌ [Telegram] Retry also failed:', retryErr.response?.data?.description || retryErr.message);
        }
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
        console.log('📱 [Telegram] Verified active Telegram Chat ID');
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

  const isRegistered = Boolean(state?.creds?.registered);
  const rawNumber = (process.env.PHONE_NUMBER || '').replace(/[^0-9]/g, '');

  if (!isRegistered && rawNumber && !isPairingRequested) {
    isPairingRequested = true;
    console.log(`\n⏳ Requesting 8-digit Pairing Code for phone number: +${rawNumber}...`);

    setTimeout(async () => {
      try {
        if (state?.creds?.registered) return;

        const code = await waSocket.requestPairingCode(rawNumber);
        currentPairingCode = code;
        console.log('\n' + '='.repeat(50));
        console.log(`🔥 YOUR WHATSAPP PAIRING CODE: ${code}`);
        console.log('='.repeat(50));
        console.log('👉 Open WhatsApp on your phone -> Settings -> Linked Devices -> "Link with phone number instead"');
        console.log(`👉 Enter this 8-digit code: ${code}\n`);
      } catch (err) {
        console.error('❌ Failed to get pairing code:', err.message);
        isPairingRequested = false;
      }
    }, 5000);
  }

  // Connection Update Event
  waSocket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    const statusCode = lastDisconnect?.error?.output?.statusCode;

    // Generate Visual QR code for Web Interface
    if (qr) {
      try {
        currentQrDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 8 });
      } catch (e) {
        console.error('Failed to generate QR data URL:', e.message);
      }
      qrcodeTerminal.generate(qr, { small: true });
    }

    if (connection === 'close') {
      isConnected = false;
      const isRegisteredNow = Boolean(state?.creds?.registered);

      console.log(`⚠️ WhatsApp connection closed. Code: ${statusCode || 'unknown'}, Registered: ${isRegisteredNow}`);

      // If Code 401 (logged out or unlinked or expired initial state)
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('⚠️ Session reset / unlinked (401). Clearing temporary session files...');
        try {
          fs.rmSync(authDir, { recursive: true, force: true });
        } catch (e) {}
        isPairingRequested = false;
        currentPairingCode = null;
        currentQrDataUrl = null;
        setTimeout(startWhatsApp, 3000);
        return;
      }

      // During pairing handshake: 515 (restartRequired) is normal
      if (statusCode === DisconnectReason.restartRequired) {
        console.log('🔄 Completing WhatsApp pairing handshake...');
        setTimeout(startWhatsApp, 2000);
        return;
      }

      // Reconnect on other network blips
      console.log('🔄 Reconnecting WhatsApp...');
      setTimeout(startWhatsApp, 3000);
    } else if (connection === 'open') {
      isConnected = true;
      isPairingRequested = false;
      currentQrDataUrl = null;
      currentPairingCode = null;
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
        profilePicUrl = null;
      }

      // 2. Send Telegram Notification
      await sendToTelegram({
        name: senderName,
        number: senderNumber,
        message: messageContent,
        profilePicUrl: profilePicUrl
      });

      // 3. Send WhatsApp Auto-Reply with cooldown
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
  if (isConnected) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WhatsApp Bot - Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 60px 20px; background-color: #f0f2f5;">
          <div style="max-width: 500px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
            <div style="font-size: 54px; margin-bottom: 10px;">✅</div>
            <h2 style="color: #128c7e; margin-bottom: 8px;">Bot is Active & Running</h2>
            <p style="color: #555; font-size: 16px;">WhatsApp is connected and listening for messages 24/7.</p>
            <div style="margin-top: 25px; padding: 12px; background: #e8f5e9; border-radius: 8px; color: #2e7d32; font-weight: 500;">
              Uptime: ${Math.floor(process.uptime())} seconds
            </div>
          </div>
        </body>
      </html>
    `);
  }

  // If not connected yet, display Live QR code & instructions
  return res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>WhatsApp Bot - Link Device</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <meta http-equiv="refresh" content="25">
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; text-align: center; padding: 40px 20px; background-color: #f0f2f5;">
        <div style="max-width: 480px; margin: 0 auto; background: white; padding: 35px 25px; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.08);">
          <h2 style="color: #075e54; margin-top: 0;">📲 Link WhatsApp Device</h2>
          <p style="color: #666; font-size: 15px; margin-bottom: 25px;">
            Open <b>WhatsApp</b> on your phone &rarr; <b>Linked Devices</b> &rarr; <b>Link a Device</b> &rarr; Scan this QR Code:
          </p>

          ${
            currentQrDataUrl
              ? `<div style="display: inline-block; padding: 12px; background: white; border: 3px solid #25D366; border-radius: 14px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
                   <img src="${currentQrDataUrl}" alt="WhatsApp QR Code" width="260" height="260" style="display: block;" />
                 </div>
                 <p style="color: #888; font-size: 13px; margin-top: 15px;">(Auto-refreshes every 25 seconds)</p>`
              : `<div style="padding: 40px 20px; background: #fbfbfb; border-radius: 12px; border: 1px dashed #ccc;">
                   <div style="font-size: 32px; margin-bottom: 10px;">⏳</div>
                   <p style="color: #777; margin: 0;">Generating QR Code... Please wait 5-10 seconds and refresh.</p>
                 </div>`
          }

          ${
            currentPairingCode
              ? `<div style="margin-top: 25px; padding: 14px; background: #f9f9f9; border-radius: 10px; border: 1px solid #eee;">
                   <span style="color: #666; font-size: 14px;">Or use Pairing Code:</span><br/>
                   <b style="font-size: 24px; letter-spacing: 3px; color: #128c7e;">${currentPairingCode}</b>
                 </div>`
              : ''
          }
        </div>
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

  // Automatic Self-Ping to prevent Render free-tier sleep
  const pingTarget = process.env.RENDER_EXTERNAL_URL || process.env.SERVER_URL;
  const PING_INTERVAL = 8 * 60 * 1000; // 8 minutes (Render sleeps after 15 minutes)

  if (pingTarget) {
    console.log(`⏱️ Auto Keep-Alive enabled for: ${pingTarget}/health (interval: 8m)`);
    setInterval(async () => {
      try {
        const res = await axios.get(`${pingTarget}/health`);
        console.log(`💓 [Keep-Alive] Self-ping successful | uptime: ${res.data?.uptimeSeconds}s`);
      } catch (pingErr) {
        console.warn(`⚠️ [Keep-Alive] Self-ping warning: ${pingErr.message}`);
      }
    }, PING_INTERVAL);
  } else {
    console.log('ℹ️ RENDER_EXTERNAL_URL not yet detected. External pinger (e.g. cron-job.org) is also recommended.');
  }
});
