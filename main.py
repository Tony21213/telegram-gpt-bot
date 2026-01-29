from flask import Flask
import threading
import bot  # импортируем bot.py, чтобы он сразу запускался

app = Flask(__name__)

@app.route("/")
def home():
    return "Bot is running ✅"

def run():
    app.run(host="0.0.0.0", port=8080)

# Запускаем Flask в отдельном потоке, чтобы бот продолжал работать
threading.Thread(target=run).start()
