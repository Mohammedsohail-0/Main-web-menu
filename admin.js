// admin.js — modular admin with "update only modified" behavior
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.5.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, query, orderBy,
  writeBatch, setDoc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-firestore.js";

import { 
  getStorage, ref, uploadBytes, getDownloadURL 
} from "https://www.gstatic.com/firebasejs/12.5.0/firebase-storage.js";

/* =========================
   CONFIG
   ========================= */
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
const storage = getStorage(app);
/* =========================
   UTIL & STATE
   ========================= */
const rid = "my_restaurant"
document.getElementById('ridDisplay').textContent = rid;

const sectionsContainer = document.getElementById('sectionsContainer');
const loader = document.getElementById('loader');
const addSectionBtn = document.getElementById('addSectionBtn');
const deleteSectionBtn = document.getElementById('deleteSectionBtn');
const updateMenuBtn = document.getElementById('updateMenuBtn');

// Local in-memory state
// sections: [{ id, title, active, order, items: [{ id, name, desc, price }] }]
let sections = [];

// change tracking
const changedSections = new Map();   // secId -> { title?, active?, order? }
const newSections = new Map();       // tempId -> { title, active, order, items: [...] }
const deletedSections = new Set();   // secId
const changedItems = new Map();      // secId -> Map(itemId -> data)
const newItems = new Map();          // secId -> Map(tempId -> data)
const deletedItems = new Map();      // secId -> Set(itemId)

/* =========================
   DOM RENDER
   ========================= */
function makeSectionElement(section) {
  const secId = section.id;
  const el = document.createElement('div');
  el.className = 'section-card';
  el.dataset.sectionId = secId;

  // Header
  const header = document.createElement('div');
  header.className = 'section-header';
  const titleInput = document.createElement('input');
  titleInput.value = section.title || 'Untitled section';
  titleInput.className = 'section-title';
  titleInput.disabled = true;
  const editBtn = document.createElement('button');
  editBtn.className = 'btn'; editBtn.textContent = '✏️ Edit';
  editBtn.addEventListener('click', () => {
    titleInput.disabled = !titleInput.disabled;
    if(!titleInput.disabled) { titleInput.focus(); editBtn.textContent = '🔒 Done'; }
    else editBtn.textContent = '✏️ Edit';
  });
  titleInput.addEventListener('blur', () => { if(titleInput.value !== section.title) markSectionChanged(secId, { title: titleInput.value }); });

  const toggleLabel = document.createElement('label'); toggleLabel.className = 'toggle';
  const toggleInput = document.createElement('input'); toggleInput.type = 'checkbox'; toggleInput.checked = section.active !== false;
  toggleInput.addEventListener('change', () => markSectionChanged(secId, { active: toggleInput.checked }));
  toggleLabel.append(toggleInput, document.createTextNode(toggleInput.checked ? ' Visible' : ' Hidden'));

  const actions = document.createElement('div'); actions.className = 'section-actions';
  actions.append(toggleLabel, editBtn);
  header.append(titleInput, actions);

  // Items
  const itemsContainer = document.createElement('div'); itemsContainer.className = 'items-container';
  (section.items || []).forEach(item => itemsContainer.appendChild(makeItemRow(secId, item)));

  // Add Button
  const addItemBtn = document.createElement('button');
  addItemBtn.className = 'btn large full-width';
  addItemBtn.style.marginTop = '20px';
  addItemBtn.textContent = '+ ADD NEW ITEM';

  // --- ADD FORM (With File Upload) ---
  const addForm = document.createElement('div');
  addForm.className = 'add-item-form';
  
  addForm.innerHTML = `
    <div class="card-top-row">
      <div class="order-badge">ORDER NO. <input id="newOrder" class="order-input" type="number" value="${(section.items?.length || 0) + 1}"></div>
      <div class="btn" style="opacity:1; cursor:default">NEW ITEM</div>
    </div>
    <div class="card-grid">
      <div class="inputs-area">
        <div class="name-price-row">
          <input id="newName" class="input-box" placeholder="ITEM NAME">
          <input id="newPrice" class="input-box" type="number" placeholder="PRICE" style="width:100px">
        </div>
        <textarea id="newDesc" class="input-box desc-box" placeholder="ITEM DESCRIPTION..."></textarea>
      </div>
      <div class="image-area" id="newImgArea" style="cursor:pointer; position:relative">
        <img id="newPreview" class="image-preview" src="https://via.placeholder.com/150?text=CLICK+TO+UPLOAD">
        <input type="file" id="newFileInput" accept="image/*" style="display:none">
        <div id="uploadMsg" style="position:absolute; bottom:10px; left:0; right:0; text-align:center; font-size:10px; background:rgba(255,255,255,0.8); display:none">Uploading...</div>
      </div>
    </div>
    <div class="card-actions">
      <div class="action-group">
        <button id="confirmAdd" class="btn primary">ADD TO MENU</button>
        <button id="cancelAdd" class="btn">CANCEL</button>
      </div>
    </div>
  `;

  // Wiring
  const inputs = {
    name: addForm.querySelector('#newName'),
    price: addForm.querySelector('#newPrice'),
    desc: addForm.querySelector('#newDesc'),
    order: addForm.querySelector('#newOrder'),
    preview: addForm.querySelector('#newPreview'),
    file: addForm.querySelector('#newFileInput'),
    area: addForm.querySelector('#newImgArea'),
    msg: addForm.querySelector('#uploadMsg'),
    addBtn: addForm.querySelector('#confirmAdd'),
    cancelBtn: addForm.querySelector('#cancelAdd')
  };

  // 1. Trigger File Selection
  inputs.area.addEventListener('click', () => inputs.file.click());

  // 2. Handle Upload
  let uploadedUrl = '';
  inputs.file.addEventListener('change', async () => {
    const file = inputs.file.files[0];
    if(!file) return;

    inputs.msg.style.display = 'block'; // Show "Uploading..."
    inputs.preview.style.opacity = 0.5;

    uploadedUrl = await uploadToStorage(file); // Upload to Storage
    
    if(uploadedUrl) {
      inputs.preview.src = uploadedUrl;
    }
    inputs.msg.style.display = 'none';
    inputs.preview.style.opacity = 1;
  });

  // 3. Confirm Add
  inputs.addBtn.addEventListener('click', () => {
    const name = inputs.name.value.trim();
    if (!name) return alert('Name required');
    
    const tempId = 'new_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const data = {
      name: name,
      desc: inputs.desc.value,
      price: parseFloat(inputs.price.value) || 0,
      image: uploadedUrl, // Use the URL we got from storage
      active: true,
      order: parseInt(inputs.order.value) || 0
    };

    addLocalNewItem(secId, tempId, data);
    itemsContainer.appendChild(makeItemRow(secId, { id: tempId, ...data }));

    // Reset
    inputs.name.value = ''; inputs.desc.value = ''; inputs.price.value = ''; 
    inputs.preview.src = 'https://via.placeholder.com/150?text=CLICK+TO+UPLOAD';
    uploadedUrl = '';
    inputs.file.value = '';
    
    addForm.classList.remove('open');
    addItemBtn.style.display = 'block';
  });

  // Show/Hide
  addItemBtn.addEventListener('click', () => { addForm.classList.add('open'); addItemBtn.style.display = 'none'; inputs.name.focus(); });
  inputs.cancelBtn.addEventListener('click', () => { addForm.classList.remove('open'); addItemBtn.style.display = 'block'; });

  // Selection
  el.addEventListener('click', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.item-row')) return;
    document.querySelectorAll('.section-card').forEach(s => s.classList.remove('selected'));
    el.classList.add('selected');
    document.body.dataset.selectedSection = secId;
  });

  el.append(header, itemsContainer, addForm, addItemBtn);
  return el;
}
//helper
async function uploadToStorage(file) {
    const API_KEY = "bfcf47ec80f62d859c134850066ea52f"; 
    const formData = new FormData();
    formData.append("image", file);

    try {
        console.log(" Uploading...");
        const response = await fetch(`https://api.imgbb.com/1/upload?key=${API_KEY}`, {
            method: "POST",
            body: formData,
        });
        const data = await response.json();
        if (data.success) return data.data.url;
        else throw new Error(data.error.message);
    } catch (error) {
        console.error("Upload Failed:", error);
        alert("Upload Failed: " + error.message);
        return null;
    }
}

function makeItemRow(secId, item) {
  const id = item.id;
  
  const row = document.createElement('div');
  row.className = 'item-row';
  row.dataset.itemId = id;

  // --- TOP ROW ---
  const topRow = document.createElement('div');
  topRow.className = 'card-top-row';

  const orderBadge = document.createElement('div');
  orderBadge.className = 'order-badge';
  orderBadge.innerHTML = 'ORDER NO. <input class="order-input" type="number" value="' + (item.order ?? 0) + '">';
  const orderInput = orderBadge.querySelector('input');

  const activeLabel = document.createElement('label');
  activeLabel.className = 'btn'; 
  activeLabel.style.cursor = 'pointer';
  const activeCheck = document.createElement('input');
  activeCheck.type = 'checkbox';
  activeCheck.checked = item.active !== false; 
  activeCheck.style.display = 'none';
  const activeText = document.createElement('span');
  activeText.textContent = activeCheck.checked ? 'SHOWING ON MENU' : 'HIDDEN';
  
  activeCheck.addEventListener('change', () => {
    activeText.textContent = activeCheck.checked ? 'SHOWING ON MENU' : 'HIDDEN';
    activeLabel.style.opacity = activeCheck.checked ? '1' : '0.5';
    triggerChange();
  });
  activeLabel.append(activeCheck, activeText);
  topRow.append(orderBadge, activeLabel);

  // --- MIDDLE ROW ---
  const grid = document.createElement('div');
  grid.className = 'card-grid';

  const inputsArea = document.createElement('div');
  inputsArea.className = 'inputs-area';
  
  const splitRow = document.createElement('div');
  splitRow.className = 'name-price-row';
  const nameInput = document.createElement('input'); nameInput.className = 'input-box'; nameInput.placeholder = 'ITEM NAME'; nameInput.value = item.name || '';
  const priceInput = document.createElement('input'); priceInput.className = 'input-box'; priceInput.placeholder = 'PRICE'; priceInput.type = 'number'; priceInput.style.width = '100px'; priceInput.value = item.price ?? 0;
  splitRow.append(nameInput, priceInput);

  const descInput = document.createElement('textarea'); descInput.className = 'input-box desc-box'; descInput.placeholder = 'ITEM DESCRIPTION...'; descInput.value = item.desc || '';
  inputsArea.append(splitRow, descInput);

  // Image Area
  const imageArea = document.createElement('div');
  imageArea.className = 'image-area';
  
  const imgPreview = document.createElement('img'); 
  imgPreview.className = 'image-preview';
  imgPreview.src = item.image || 'https://via.placeholder.com/150?text=NO+IMG';
  
  // NEW: Hidden File Input
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none'; // Hidden, triggered by button
  
  // Store the current URL in a dataset attribute so we can access it easily
  row.dataset.imageUrl = item.image || '';

  imageArea.append(imgPreview, fileInput);
  grid.append(inputsArea, imageArea);

  // --- BOTTOM ROW ---
  const actionsRow = document.createElement('div');
  actionsRow.className = 'card-actions';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'action-group';
  const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.textContent = 'SAVE';
  const delBtn = document.createElement('button'); delBtn.className = 'btn danger'; delBtn.textContent = 'DELETE';
  leftGroup.append(saveBtn, delBtn);

  const rightGroup = document.createElement('div');
  rightGroup.className = 'action-group';
  
  // NEW: Change Image triggers file input
  const changeImgBtn = document.createElement('button'); 
  changeImgBtn.className = 'btn'; 
  changeImgBtn.textContent = 'CHANGE IMAGE';
  
  const removeImgBtn = document.createElement('button'); 
  removeImgBtn.className = 'btn'; 
  removeImgBtn.textContent = 'REMOVE IMAGE';
  rightGroup.append(changeImgBtn, removeImgBtn);

  actionsRow.append(leftGroup, rightGroup);

  // --- LOGIC ---
  
  // 1. File Upload Logic
  changeImgBtn.addEventListener('click', () => fileInput.click()); // Click button -> Open file dialog

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;

    // Visual feedback
    changeImgBtn.textContent = 'Uploading...';
    changeImgBtn.disabled = true;
    imgPreview.style.opacity = '0.5';

    const url = await uploadToStorage(file); // Upload to Firebase

    if (url) {
      imgPreview.src = url;
      row.dataset.imageUrl = url; // Update stored URL
      triggerChange(); // Mark item as modified
    }

    // Reset UI
    changeImgBtn.textContent = 'CHANGE IMAGE';
    changeImgBtn.disabled = false;
    imgPreview.style.opacity = '1';
  });

  // 2. Remove Image Logic
  removeImgBtn.addEventListener('click', () => {
    if(confirm('Remove image?')) {
      row.dataset.imageUrl = '';
      imgPreview.src = 'https://via.placeholder.com/150?text=NO+IMG';
      fileInput.value = ''; // Reset file input
      triggerChange();
    }
  });

  function triggerChange() {
    markItemChanged(secId, id, {
      name: nameInput.value,
      desc: descInput.value,
      price: parseFloat(priceInput.value) || 0,
      image: row.dataset.imageUrl, // Read from dataset
      active: activeCheck.checked,
      order: parseInt(orderInput.value) || 0
    });
  }

  [nameInput, descInput, priceInput, orderInput].forEach(el => el.addEventListener('change', triggerChange));

  saveBtn.addEventListener('click', () => {
    triggerChange();
    saveBtn.textContent = 'SAVED';
    setTimeout(() => saveBtn.textContent = 'SAVE', 900);
  });

  delBtn.addEventListener('click', () => {
    if(confirm('Delete this item?')) {
      markItemDeleted(secId, id);
      row.remove();
    }
  });

  row.append(topRow, grid, actionsRow);
  return row;
}
/* =========================
   LOCAL CHANGE TRACKING
   ========================= */

function markSectionChanged(secId, patch) {
  const prev = changedSections.get(secId) || {};
  changedSections.set(secId, { ...prev, ...patch });
}

function addLocalNewSection(tempId, data) {
  newSections.set(tempId, data);
  // create structure in memory for rendering
  sections.push({ id: tempId, title: data.title, active: data.active, items: data.items || [] });
  renderSections();
}

function markSectionDeleted(secId) {
  // if new section, just remove from newSections
  if (newSections.has(secId)) {
    newSections.delete(secId);
    sections = sections.filter(s => s.id !== secId);
    renderSections();
    return;
  }
  deletedSections.add(secId);
  sections = sections.filter(s => s.id !== secId);
  renderSections();
}

function markItemChanged(secId, itemId, data) {
  // if item is new
  if (String(itemId).startsWith('new_')) {
    let map = newItems.get(secId);
    if (!map) { map = new Map(); newItems.set(secId, map); }
    map.set(itemId, data);
    return;
  }
  let secMap = changedItems.get(secId);
  if (!secMap) { secMap = new Map(); changedItems.set(secId, secMap); }
  secMap.set(itemId, data);
}

function addLocalNewItem(secId, tempId, data) {
  let map = newItems.get(secId);
  if (!map) { map = new Map(); newItems.set(secId, map); }
  map.set(tempId, data);
  // also push into local sections representation
  const s = sections.find(s => s.id === secId);
  if (s) s.items = s.items || [];
  s.items.push({ id: tempId, ...data });
}

function markItemDeleted(secId, itemId) {
  // if new item, remove from newItems
  if (String(itemId).startsWith('new_')) {
    const map = newItems.get(secId);
    if (map) map.delete(itemId);
    return;
  }
  let set = deletedItems.get(secId);
  if (!set) { set = new Set(); deletedItems.set(secId, set); }
  set.add(itemId);
}

/* =========================
   DATA LOAD & RENDER
   ========================= */

async function loadFromFirestore() {
  loader.style.display = 'block';
  sectionsContainer.innerHTML = '';
  sections = [];

  // fetch sections
  const secsRef = collection(db, "restaurants", rid, "sections");
  const q = query(secsRef, orderBy("order", "asc"));
  const secSnap = await getDocs(q);

  for (const sdoc of secSnap.docs) {
    const sdata = sdoc.data();
    const secObj = { id: sdoc.id, title: sdata.title || 'Untitled', active: sdata.active !== false, order: sdata.order || 0, items: [] };
    // load items
    const itemsRef = collection(db, "restaurants", rid, "sections", sdoc.id, "items");
    const itemsQ = query(itemsRef, orderBy("order", "asc"));
    const itemsSnap = await getDocs(itemsQ);
    for (const idoc of itemsSnap.docs) {
      const idata = idoc.data();
      secObj.items.push({ id: idoc.id, name: idata.name || '', desc: idata.desc || '', price: idata.price || 0, order: idata.order || 0, image: idata.image || 'https://unsplash-assets.imgix.net/empty-states/photos.png?auto=format&fit=crop&q=60', active: idata.active || false });
    }
    sections.push(secObj);
  }

  renderSections();
  loader.style.display = 'none';
}

function renderSections() {
  sectionsContainer.innerHTML = '';
  for (const sec of sections) {
    const el = makeSectionElement(sec);
    sectionsContainer.appendChild(el);
  }
}

/* =========================
   BUTTONS: Add/Delete Section
   ========================= */

addSectionBtn.addEventListener('click', () => {
  const title = prompt('Section title?') || 'New Section';
  const tempId = 'newsec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const data = { title, active: true, order: Date.now(), items: [] };
  addLocalNewSection(tempId, data);
});

deleteSectionBtn.addEventListener('click', () => {
  const sel = document.body.dataset.selectedSection;
  if (!sel) return alert('Select a section by clicking its header first.');
  if (!confirm('Delete this section?')) return;
  markSectionDeleted(sel);
});

/* =========================
   PUBLISH: Update Only Modified
   ========================= */

updateMenuBtn.addEventListener('click', publishChanges);

async function publishChanges() {
  updateMenuBtn.disabled = true;
  updateMenuBtn.textContent = 'Publishing…';
  try {
    const batch = writeBatch(db);

    // 1) Handle modified existing sections
    for (const [secId, patch] of changedSections.entries()) {
      const secRef = doc(db, "restaurants", rid, "sections", secId);
      batch.update(secRef, patch);
    }

    // 2) Handle deleted sections (delete section doc and its items)
    for (const secId of deletedSections) {
      // delete items first
      const itemsRef = collection(db, "restaurants", rid, "sections", secId, "items");
      const itemsSnap = await getDocs(itemsRef);
      for (const it of itemsSnap.docs) {
        batch.delete(doc(db, "restaurants", rid, "sections", secId, "items", it.id));
      }
      // delete section
      batch.delete(doc(db, "restaurants", rid, "sections", secId));
    }

    // 3) Handle modified items
    for (const [secId, map] of changedItems.entries()) {
      for (const [itemId, data] of map.entries()) {
        const itRef = doc(db, "restaurants", rid, "sections", secId, "items", itemId);
        batch.update(itRef, data);
      }
    }

    // 4) Handle deleted items
    for (const [secId, set] of deletedItems.entries()) {
      for (const itemId of set) {
        batch.delete(doc(db, "restaurants", rid, "sections", secId, "items", itemId));
      }
    }

    // 5) Handle new sections & their new items using batch.set with generated ids
    for (const [tempId, sdata] of newSections.entries()) {
      const newSecId = 'sec_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
      const secRef = doc(db, "restaurants", rid, "sections", newSecId);
      const secPayload = { title: sdata.title || 'New Section', active: !!sdata.active, order: sdata.order || Date.now() };
      batch.set(secRef, secPayload);
      // if sdata.items exists, add them
      if (sdata.items && sdata.items.length) {
        for (const it of sdata.items) {
          const newItemId = 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
          const itRef = doc(db, "restaurants", rid, "sections", newSecId, "items", newItemId);
          batch.set(itRef, { name: it.name || '', desc: it.desc || '', price: it.price || 0, order: it.order || Date.now(), image: it.image||'https://unsplash-assets.imgix.net/empty-states/photos.png?auto=format&fit=crop&q=60', active: it.active||false });
        }
      }
    }

    // 6) Handle new items under existing sections
    for (const [secId, map] of newItems.entries()) {
      for (const [tempId, data] of map.entries()) {
        const newItemId = 'item_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
        const itRef = doc(db, "restaurants", rid, "sections", secId, "items", newItemId);
          batch.set(itRef, { name: data.name || '', desc: data.desc || '', price: data.price || 0, order: data.order || Date.now(), image: data.image||'https://unsplash-assets.imgix.net/empty-states/photos.png?auto=format&fit=crop&q=60', active: data.active||false });
      }
    }

    // commit batch
    await batch.commit();

    // clear local trackers and reload fresh
    changedSections.clear(); newSections.clear(); deletedSections.clear();
    changedItems.clear(); newItems.clear(); deletedItems.clear();
    alert('Published successfully ✅');
    await loadFromFirestore();

  } catch (err) {
    console.error('Publish error', err);
    alert('Publish failed: ' + (err.message || err));
  } finally {
    updateMenuBtn.disabled = false;
    updateMenuBtn.textContent = 'Update Menu (Publish changes)';
  }
}

/* =========================
   INIT
   ========================= */
loadFromFirestore();
