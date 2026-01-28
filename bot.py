import os
import openai
from telegram import Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters
)

# Получаем ключ OpenAI из переменных окружения
openai.api_key = os.getenv("OPENAI_API_KEY")

# Команда /start
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("Привет 👋 Я твой личный бот в Telegram!")

# Основная функция обработки сообщений
async def chat(update: Update, context: ContextTypes.DEFAULT_TYPE):
    # Для отладки — видим в логах Render все входящие сообщения
    print("MESSAGE:", update.message.text)

    # Отправляем запрос в OpenAI
    response = openai.ChatCompletion.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": "Ты полезный ассистент, эксперт по CAD, exocad, STL и разработке."},
            {"role": "user", "content": update.message.text}
        ]
    )

    # Отправляем ответ пользователю
    await update.message.reply_text(response.choices[0].message.content)

# Создаём приложение Telegram
app = ApplicationBuilder().token(os.getenv("TELEGRAM_TOKEN")).build()

# Регистрируем обработчики
app.add_handler(CommandHandler("start", start))
app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, chat))

# Выводим в логи, что бот стартовал
print("BOT IS RUNNING")

# Запускаем polling
app.run_polling()
