
/* -------------------------
   Placeholder: Firestore integration hint (replace init() above later)
   ------------------------- */


// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-analytics.js";
import { getFirestore, collection, doc, getDocs, query, orderBy } 
from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
    apiKey: "AIzaSyDDaK9cmhXs32IJTCdZWCp2mDMeYOxhaO0",
    authDomain: "web-menu-5e5fa.firebaseapp.com",
    projectId: "web-menu-5e5fa",
    storageBucket: "web-menu-5e5fa.firebasestorage.app",
    messagingSenderId: "160704475634",
    appId: "1:160704475634:web:a8b93e534952909bfbfb6b",
    measurementId: "G-BF9C41D0F1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app);



/* -------------------------
   DOM references
   ------------------------- */
const mainContainer = document.getElementById('mainContent');
const sectionListEl = document.getElementById('sectionList');
const mobileCatsInner = document.getElementById('mobileCatsInner');
const loader = document.getElementById('loader');

/* -------------------------
   Render helpers
   ------------------------- */
function formatPrice(n) { return (typeof n === 'number') ? `€${n.toFixed(2)}` : n; }

function createItemCard(item) {
    const card = document.createElement('article');
    card.className = 'menu-item-card';
    
    // --- FIX IS HERE ---
    // Changed item.imageURL to item.image to match your database
    card.innerHTML = `
    <img class="item-image" src="${item.image || 'https://via.placeholder.com/400x300'}" alt="${escapeHtml(item.name)}">
    <div class="item-body">
      <div>
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
        <p class="item-desc">${escapeHtml(item.desc || '')}</p>
      </div>
      <div class="item-footer">
        <div class="item-price">${formatPrice(item.price)}</div>
      </div>
    </div>
  `;
    return card;
}

function escapeHtml(s) {
    if (!s) return '';
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

/* -------------------------
   Render full menu from data
   ------------------------- */
function renderMenu(data) {
    // sort by order safety
    data.sort((a, b) => (a.order || 0) - (b.order || 0));

    // clear
    mainContainer.innerHTML = '';
    sectionListEl.innerHTML = '';
    mobileCatsInner.innerHTML = '';

    data.forEach(section => {
        // sidebar item
        const li = document.createElement('li');
        li.textContent = section.title;
        li.dataset.target = `section_${section.id}`;
        li.tabIndex = 0;
        sectionListEl.appendChild(li);

        // mobile pill
        const pill = document.createElement('button');
        pill.className = 'cat-pill';
        pill.textContent = section.title;
        pill.dataset.target = `section_${section.id}`;
        mobileCatsInner.appendChild(pill);

        // section block
        const sec = document.createElement('section');
        sec.className = 'menu-section';
        sec.id = `section_${section.id}`;
        sec.innerHTML = `<h2 class="section-title">${escapeHtml(section.title)}</h2>`;

        const grid = document.createElement('div');
        grid.className = 'items-grid';

        (section.items || []).forEach(item => {
            grid.appendChild(createItemCard(item));
        });

        sec.appendChild(grid);
        mainContainer.appendChild(sec);
    });

    // attach click handlers for sidebar & mobile pills
    attachSectionClicks();
    observeSections();
}

/* -------------------------
   Scroll and active highlight
   ------------------------- */
function attachSectionClicks() {
    const allSidebar = document.querySelectorAll('.section-list li');
    const allPills = document.querySelectorAll('.cat-pill');

    function goto(targetId) {
        const target = document.getElementById(targetId);
        if (!target) return;
        // focus for accessibility then smooth scroll
        target.focus({ preventScroll: true });
        window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - 80, behavior: 'smooth' });
    }

    allSidebar.forEach(li => {
        li.onclick = () => goto(li.dataset.target);
        li.onkeypress = (e) => { if (e.key === 'Enter') goto(li.dataset.target); }
    });

    allPills.forEach(p => {
        p.onclick = () => goto(p.dataset.target);
    });
}

/* IntersectionObserver to set active section (works across screen sizes) */
let observer = null;
function observeSections() {
    // disconnect previous
    if (observer) observer.disconnect();

    const els = document.querySelectorAll('.menu-section');
    const options = {
        root: null,
        rootMargin: '-40% 0px -40% 0px', // trigger when section is centered-ish
        threshold: 0
    };
    observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            const id = entry.target.id;
            const selector = `[data-target="${id}"]`;
            if (entry.isIntersecting) {
                // set active on both sidebar and pills
                document.querySelectorAll('.section-list li').forEach(x => x.classList.toggle('active', x.dataset.target === id));
                document.querySelectorAll('.cat-pill').forEach(x => x.classList.toggle('active', x.dataset.target === id));
            }
        });
    }, options);

    els.forEach(e => observer.observe(e));
}

/* -------------------------
   DATA FETCHING (The Real Init)
   ------------------------- */

async function loadMenu() {
  loader.style.display = "flex";
  mainContainer.setAttribute("aria-busy", "true");

  const restaurantId = "my_restaurant";
  const sectionsRef = collection(db, "restaurants", restaurantId, "sections");
  const q = query(sectionsRef, orderBy("order", "asc"));
  const sectionsSnap = await getDocs(q);

  const menuData = [];

  // Loop through each section
  for (const sec of sectionsSnap.docs) {
    const sectionData = sec.data();
    if (sectionData.active === false) continue; // Only skip if explicitly false

    const sectionObj = {
      id: sec.id,
      title: sectionData.title,
      order: sectionData.order || 0,
      items: []
    };

    // 🔹 Fetch items subcollection for this section
    const itemsRef = collection(db, "restaurants", restaurantId, "sections", sec.id, "items");
    const itemsQuery = query(itemsRef, orderBy("order", "asc"));
    const itemsSnap = await getDocs(itemsQuery);

    itemsSnap.forEach(itemDoc => {
      const itemData = itemDoc.data();
      if (itemData.active === false) return; // Only skip if explicitly false
      
      sectionObj.items.push({
        id: itemDoc.id,
        name: itemData.name,
        desc: itemData.desc,
        price: itemData.price,
        image: itemData.image // This matches your Admin code
      });
    });

    menuData.push(sectionObj);
  }

  loader.style.display = "none";
  mainContainer.removeAttribute("aria-busy");

  renderMenu(menuData);
}

// Run when page loads
window.addEventListener("load", loadMenu);