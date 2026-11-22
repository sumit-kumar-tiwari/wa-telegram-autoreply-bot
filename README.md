# 🤖 WhatsApp Auto-Reply & Telegram Notifier Bot

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sumit-kumar-tiwari/wa-telegram-autoreply-bot)

A lightweight, 24/7 automated bot that sends instant auto-replies to incoming WhatsApp messages and delivers real-time notifications with sender information (Name, Phone Number, Profile Photo, and Message Content) directly to your Telegram account.

---

## ✨ Features

- 💬 **Instant Auto-Reply:** Automatically replies to direct 1-on-1 WhatsApp messages with a customizable message (e.g., *"he'll response once he get online."*).
- 🔔 **Instant Telegram Alerts:** Delivers detailed notifications to Telegram including:
  - 👤 **Sender Name**
  - 📱 **Phone Number**
  - 🖼️ **Sender Profile Picture** (retrieved automatically)
  - 💬 **Message Text / Media Type** (Photos, Videos, Audio, Documents, Locations, etc.)
  - ⏰ **Timestamp (IST)**
- 🛡️ **Anti-Spam Cooldown:** Prevents spamming contacts with repeated auto-replies if they send multiple consecutive messages (customizable cooldown window, default 15 minutes).
- 🚫 **Group & Status Filter:** Automatically ignores group chats and WhatsApp status broadcasts to prevent unnecessary notifications.
- 🔑 **Browserless Pairing Code:** Authenticate in headless cloud environments (like Render or VPS) using an 8-digit phone pairing code without needing a browser or camera.
- ☁️ **Cloud-Ready & Memory-Efficient:** Built using `@whiskeysockets/baileys` directly over WhatsApp sockets (consumes only ~50MB RAM, ideal for free tier cloud hosting). Includes an integrated Express web server for uptime health checks.

---

## 🚀 One-Click Deployment (Render.com)

### Step 1: Obtain Telegram Credentials
1. Open Telegram and search for **`@BotFather`**.
2. Send `/newbot`, then follow the prompts to choose a bot name and username.
3. Copy the **HTTP API Token** provided by BotFather (e.g., `123456789:ABCdefGhI...`).
4. Search for **`@userinfobot`** on Telegram and click `/start`. Copy your numeric **Id** (this is your `TELEGRAM_CHAT_ID`).
5. Open your newly created bot in Telegram and click **`/start`** to enable it to message you.

---

### Step 2: Deploy to Render
1. Click the button below:
   
   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sumit-kumar-tiwari/wa-telegram-autoreply-bot)

2. Fill in the required environment variables:
   - `TELEGRAM_BOT_TOKEN`: The API token from `@BotFather`.
   - `TELEGRAM_CHAT_ID`: Your Telegram numeric ID from `@userinfobot`.
   - `PHONE_NUMBER`: Your WhatsApp phone number including country code without `+` or spaces (e.g., `919876543210`).
   - `AUTO_REPLY_MESSAGE`: `he'll response once he get online.` (or your custom message).
   - `COOLDOWN_MINUTES`: `15`
3. Click **"Apply"** to deploy the service.

---

### Step 3: Link WhatsApp via Pairing Code
1. Once deployed, open the **Logs** tab in your Render dashboard.
2. Locate the 8-digit Pairing Code generated in the logs (e.g., `ABCD-1234`).
3. On your phone, open WhatsApp:
   - Go to **Settings** (or Menu) > **Linked Devices** > **Link a Device**.
   - Tap **"Link with phone number instead"** at the bottom.
   - Enter the **8-digit code** displayed in your Render logs.
4. Once linked, the logs will show:
   ```text
   🚀 WhatsApp successfully connected and ready!
   ```

---

### Step 4: Keep the Bot Running 24/7 (Prevent Free-Tier Sleep)
Render free services sleep after 15 minutes of inactivity. To keep your bot running 24/7 without interruption:
1. Copy your Render web service URL (e.g., `https://wa-telegram-bot.onrender.com`).
2. Register for a free account at [cron-job.org](https://cron-job.org).
3. Create a scheduled job:
   - **URL:** `https://your-app-name.onrender.com/health`
   - **Interval:** Every **10 minutes**.
4. This keeps the web service active continuously.

---

## ⚙️ Environment Variables

| Variable | Description | Example |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Bot API token from `@BotFather` | `123456789:ABC...` |
| `TELEGRAM_CHAT_ID` | Your Telegram user ID from `@userinfobot` | `987654321` |
| `PHONE_NUMBER` | Your WhatsApp number with country code | `919876543210` |
| `AUTO_REPLY_MESSAGE` | Automated response message sent on WhatsApp | `he'll response once he get online.` |
| `COOLDOWN_MINUTES` | Cooldown period between auto-replies to the same contact | `15` |
| `PORT` | Web server port (automatically assigned by Render) | `3000` |

---

## 🛠️ Local Development

```bash
# Clone the repository
git clone https://github.com/sumit-kumar-tiwari/wa-telegram-autoreply-bot.git
cd wa-telegram-autoreply-bot

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your credentials

# Start the bot
npm start
```

---

## 📄 License
This project is licensed under the [ISC License](LICENSE).
