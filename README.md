# 👋 Welcome to Quick Chat!

> Ready to build your own real-time chat app? Let’s get started together!

---

## 🚀 What is Quick Chat?
Quick Chat is a fun, simple web chat app built with Flask. You can register, log in, and chat instantly—all in your browser! It’s lightweight, easy to set up, and perfect for learning or quick deployment.

---

## ✨ Features
- **Register & Login:** Create your account and join the conversation.
- **Real-Time Chat:** See messages appear instantly.
- **Mobile Friendly:** Chat on your phone or desktop.
- **Offline Support:** Service Worker keeps you connected.

---

## 🗂️ Project Structure
Here’s what you’ll find inside:

```
app.py                  # Main Flask app
requirements.txt        # Python packages
FLASK_TO_APK_GUIDE.txt  # How to turn this into an Android app!
static/
  sw.js                 # Service Worker
  css/
    auth.css            # Login/Register styles
    chat.css            # Chat styles
  js/
    chat.js             # Chat logic (frontend)
templates/
  chat.html             # Chat page
  login.html            # Login page
  register.html         # Registration page
```

---

## 🏁 Get Started!

**You’ll need:**
- Python 3.7 or newer
- pip

**Let’s set it up:**
1. **Clone this repo:**
   ```bash
   git clone <repo-url>
   cd quick_chat
   ```
2. **Install the requirements:**
   ```bash
   pip install -r requirements.txt
   ```
3. **Run the app:**
   ```bash
   python app.py
   ```
4. **Open your browser:**
   Go to [http://localhost:5000](http://localhost:5000) and start chatting!

---

## 📱 Want an Android App?
Check out `FLASK_TO_APK_GUIDE.txt` for a step-by-step guide to turn Quick Chat into an APK!

---

## 📄 License
MIT License — use, share, and have fun!
