# Amar Bingo

Live bingo game server for Amar Bingo. The app was copied from the Bingo Habesha codebase and rebranded. The original repository was not modified.

Before deploying, replace the placeholders in `server.js` (and the deposit defaults in `public/index.html` and `publicindex.html`):

- `MONGODB_PASSWORD` in the host environment (Render). The user is `amarmeftuh971_db_user`, the cluster is `cluster0.ktvuu20.mongodb.net`, and the database name is `amarBingo`. Do not commit the password.
- `YOUR_TELEGRAM_BOT_TOKEN` (also used as the webhook path)
- `YOUR_ADMIN_PASSWORD` and `YOUR_FINANCE_PASSWORD`
- `YOUR_SMS_WEBHOOK_SECRET`
- `YOUR_ACCOUNT_NAME` and `YOUR_PHONE_NUMBER` for Telebirr, CBE, and the support line

There is no `.env` file in this tree. Those values were hardcoded and are now placeholders so this repo does not connect to the previous database or bot.
