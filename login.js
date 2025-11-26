// Firebase imports
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDDaK9cmhXs32IJTCdZWCp2mDMeYOxhaO0",
  authDomain: "web-menu-5e5fa.firebaseapp.com",
  projectId: "web-menu-5e5fa",
  storageBucket: "web-menu-5e5fa.firebasestorage.app",
  messagingSenderId: "160704475634",
  appId: "1:160704475634:web:a8b93e534952909bfbfb6b",
  measurementId: "G-BF9C41D0F1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const loginForm = document.getElementById("loginForm");
const errorMsg = document.getElementById("errorMsg");

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorMsg.textContent = "";

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const docRef = doc(db, "restaurants", "my_restaurant", "admin", "creds");
    const snap = await getDoc(docRef);

    if (snap.exists()) {
      const data = snap.data();
      if (username === data.username && password === data.password) {
        localStorage.setItem("adminLogin", "true");
        window.location.href = "admin.html";
      } else {
        errorMsg.textContent = "Invalid username or password.";
      }
    } else {
      errorMsg.textContent = "Admin credentials not found.";
    }
  } catch (err) {
    console.error("Login error:", err);
    errorMsg.textContent = "Error connecting to server.";
  }
});
