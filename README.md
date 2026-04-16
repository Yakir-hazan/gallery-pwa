# 🖼 Gallery PWA — גיבוי תמונות חכם

אפליקציית PWA מלאה לגיבוי תמונות מאנדרואיד לשרת.

---

## 📁 מבנה קבצים

```
gallery-pwa/
├── index.html        ← ממשק המשתמש המלא
├── styles.css        ← עיצוב מודרני (dark mode)
├── app.js            ← לוגיקה מלאה (upload, retry, compress, share)
├── sw.js             ← Service Worker (cache + background sync)
├── manifest.json     ← PWA manifest
├── server.js         ← שרת Node.js + Express
├── package.json      ← תלויות
├── .env.example      ← הגדרות סביבה
└── uploads/          ← תיקיית קבצים (נוצרת אוטומטית)
```

---

## 🚀 הרצה מהירה

### 1. התקנת תלויות

```bash
npm install
```

### 2. הגדרת סביבה

```bash
cp .env.example .env
# ערוך את .env לפי הצורך
```

### 3. הפעלת השרת

```bash
# Production
npm start

# Development (עם nodemon לרענון אוטומטי)
npm run dev
```

השרת יעלה על: **http://localhost:3000**

---

## 📱 בדיקה על אנדרואיד

### Option A — LAN (מומלץ לפיתוח)

1. וודא שהמחשב והטלפון על אותה WiFi
2. מצא את ה-IP של המחשב:
   - Windows: `ipconfig` → IPv4 Address
   - Mac/Linux: `ifconfig` → inet
3. פתח ב-Chrome על האנדרואיד:
   ```
   http://192.168.x.x:3000
   ```
4. PWA יופיע עם banner "הוסף למסך הבית"

### Option B — ngrok (מומלץ לבדיקות מהאינטרנט)

```bash
# התקן ngrok: https://ngrok.com
ngrok http 3000
```

קבל URL ציבורי כמו: `https://abc123.ngrok.io`

> **חשוב:** PWA דורש HTTPS — ngrok מספק זאת אוטומטית

### Option C — GitHub Pages / Vercel

לדפלויי מלא:
1. Frontend → `vercel deploy` / GitHub Pages
2. Backend → Railway / Render / VPS

---

## ☁️ Cloudinary (אחסון ענן)

1. צור חשבון חינמי ב-[cloudinary.com](https://cloudinary.com)
2. מצא את פרטי ה-API בדשבורד
3. הוסף ל-.env:

```env
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=123456789
CLOUDINARY_API_SECRET=your_secret
```

4. התקן:
```bash
npm install cloudinary
```

---

## 🔐 אבטחה

| פיצ'ר | פרטים |
|--------|--------|
| JWT Auth | 30 יום תוקף, HS256 |
| MIME check | רק image/* |
| גודל מקסימלי | 10MB לקובץ |
| שם קובץ | timestamp + random bytes |
| CORS | ניתן להגדרה ב-.env |

---

## ✨ פיצ'רים

### Frontend
- ✅ בחירת תמונות מרובות (`<input multiple>`)
- ✅ דחיסה לפני העלאה (Canvas, max 1920px, quality 0.7)
- ✅ עד 3 העלאות במקביל (concurrency pool)
- ✅ Retry חכם: עד 3 ניסיונות + exponential backoff
- ✅ שמירת session ב-localStorage
- ✅ כפתור "המשך גיבוי" לאחר רענון
- ✅ Web Share API (שיתוף קבצים ישירות)
- ✅ Fallback: הורדה לגיבוי
- ✅ Progress bar כללי + סטטוס לכל קובץ
- ✅ פילטר לפי סטטוס
- ✅ Preview thumbnails
- ✅ Banner אופליין + Background Sync
- ✅ PWA Install banner

### Backend
- ✅ `POST /api/upload` — העלאת תמונה
- ✅ `GET /api/images` — רשימת תמונות
- ✅ `DELETE /api/images/:name` — מחיקה
- ✅ `POST /api/auth/register` — הרשמה
- ✅ `POST /api/auth/login` — כניסה
- ✅ אחסון מקומי + Cloudinary אופציונלי
- ✅ multer + MIME validation + size limit
- ✅ שמות קבצים ייחודיים

---

## 🛠 API Reference

### POST /api/upload
```http
POST /api/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data

Body: image=<file>

Response:
{
  "success": true,
  "filename": "1234567890-abcd.jpg",
  "url": "/uploads/1234567890-abcd.jpg",
  "size": 245000,
  "storage": "local"
}
```

### GET /api/images
```http
GET /api/images

Response:
{
  "success": true,
  "images": [
    { "filename": "...", "url": "...", "size": 0, "created": "..." }
  ]
}
```

### DELETE /api/images/:name
```http
DELETE /api/images/1234567890-abcd.jpg

Response:
{ "success": true }
```

---

## 📝 הערות פיתוח

- Auth הוא **mock** בצד הלקוח — בפרודקשן חבר ל-`/api/auth/login`
- File objects לא ניתנים לסריאליזציה — resume דורש בחירה מחדש
- Blob URLs משוחררים אחרי שימוש למניעת memory leaks
- Icons (icon-192.png, icon-512.png) יש ליצור ולהוסיף לתיקייה
