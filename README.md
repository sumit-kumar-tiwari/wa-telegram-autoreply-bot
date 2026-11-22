# 🤖 WhatsApp Auto-Reply & Telegram Notifier

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sumit-kumar-tiwari/wa-telegram-autoreply-bot)

Jab bhi aapke WhatsApp par koi message aayega:
1. Sender ko auto-reply chala jayega: `"he'll response once he get online."`
2. Aapke **Telegram** par instantly notification aa jayegi:
   - 👤 **Sender ka Naam**
   - 📱 **Phone Number**
   - 🖼️ **Profile Picture**
   - 💬 **Message Text / Media type**
   - ⏰ **Exact Waqt (IST)**

---

## 🚀 Setup & Deployment Guide (Render.com par 100% Free)

### Step 1: Telegram Bot Token & Chat ID nikalna

1. Telegram par search karein: **`@BotFather`**
2. `/newbot` command send karein aur bot ka name & username choose karein.
3. BotFather aapko ek **API Token** dega (e.g., `123456789:AA...`). Isse copy kar lein.
4. Ab Telegram par search karein: **`@userinfobot`** aur `/start` karein. Ye aapko aapki numeric **Id** dega (ye aapka `TELEGRAM_CHAT_ID` hai).
5. Apne banaye hue bot me jakar ek baar `/start` zaroor press karein taaki bot aapko message bhej sake.

---

### Step 2: Code ko GitHub par Daalna

1. [GitHub.com](https://github.com) par ek naya private ya public repository banayein (e.g. `wa-telegram-bot`).
2. Is folder ke code ko GitHub par push kar dein.

---

### Step 3: Render.com par Deploy karna (Free Web Service)

1. [Render.com](https://render.com) par free account banayein ya login karein.
2. Dashboard par click karein: **`New +` -> `Web Service`**.
3. Apni GitHub repository ko connect karein.
4. Settings me ye details daalein:
   - **Name:** `wa-telegram-bot`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node index.js`
   - **Instance Type:** `Free`
5. **Environment Variables** section me jakar ye variables add karein:
   - `TELEGRAM_BOT_TOKEN`: *(Step 1 se mila hua token)*
   - `TELEGRAM_CHAT_ID`: *(Step 1 se mili hui chat id)*
   - `PHONE_NUMBER`: *(Aapka WhatsApp number country code ke sath, bina + ya space ke, jaise `919876543210`)*
   - `AUTO_REPLY_MESSAGE`: `he'll response once he get online.`
   - `COOLDOWN_MINUTES`: `15` *(Ek sender ko baar-baar spam na ho isliye 15 min ka gap)*
6. **"Deploy Web Service"** par click karein.

---

### Step 4: WhatsApp Link Karna (Pairing Code)

1. Deploy hone ke baad Render dashboard par **"Logs"** tab me jayein.
2. 5-10 second me logs me aapko ek **8-digit Pairing Code** dikhega (e.g. `ABC1-XYZ2`).
3. Apne phone me WhatsApp open karein:
   - **Settings** (ya 3 dots) -> **Linked Devices**
   - **Link a Device** par tap karein
   - Niche **"Link with phone number instead"** par tap karein
   - Render ke logs me dikha hua **8-digit code** daal dein!
4. WhatsApp successfully link ho jayega aur logs me likha aayega:  
   `🚀 WhatsApp successfully connected and ready!`

---

### Step 5: Render ko 24/7 Alive Rakhna (No Sleep)

Render ka free tier 15 min inactive rehne par so jata hai. Isse rokne ke liye:
1. Render dashboard se apni service ka URL copy karein (e.g. `https://wa-telegram-bot.onrender.com`).
2. [cron-job.org](https://cron-job.org) par free account banayein.
3. Ek naya Cronjob banayein:
   - **URL:** `https://wa-telegram-bot.onrender.com/health`
   - **Schedule:** Har **10 minutes** me run hone ke liye set karein.
4. Ab ye service Render ko har 10 minute me ping karti rahegi aur aapka bot **24/7 bina ruke chalta rahega!**
