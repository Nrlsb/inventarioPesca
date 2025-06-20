// Importaciones de Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getFirestore, collection, doc, addDoc, onSnapshot, updateDoc, deleteDoc, runTransaction, query, getDocs, Timestamp, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";

// ¡Importamos la configuración desde el archivo local 'firebase.js'!
import { firebaseConfig } from './firebase.js';

// Inicialización de Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// --- Estado Global y Constantes ---
let productsUnsubscribe = null; 
let currentOpenModal = null; 
const HISTORY_PAGE_SIZE = 15;

// --- Elementos del DOM ---
const authContainer = document.getElementById('auth-container');
const appContainer = document.getElementById('app-container');
const modalBackdrop = document.getElementById('modalBackdrop');
const modalContainer = document.getElementById('modalContainer');

// --- Funciones de Utilidad ---

function setButtonLoading(button, isLoading) {
    if (isLoading) {
        button.disabled = true;
        button.dataset.originalText = button.innerHTML;
        button.innerHTML = `<div class="w-5 h-5 border-2 border-white rounded-full animate-spin loading-spinner"></div>`;
    } else {
        if(button.dataset.originalText) {
            button.disabled = false;
            button.innerHTML = button.dataset.originalText;
        }
    }
}

function showNotification(message, type = 'error') {
    const notification = document.getElementById('notification');
    const messageP = document.getElementById('notification-message');
    
    messageP.textContent = message;
    notification.className = 'notification fixed top-0 left-1/2 -translate-x-1/2 w-full max-w-md p-4 text-white text-center rounded-b-lg shadow-lg opacity-0 -translate-y-full z-50';
    notification.classList.add(type === 'success' ? 'bg-green-600' : 'bg-red-600');
    
    notification.classList.remove('opacity-0', '-translate-y-full');
    
    setTimeout(() => {
        notification.classList.add('opacity-0', '-translate-y-full');
    }, 3000);
}

// --- Lógica de Autenticación ---

onAuthStateChanged(auth, user => {
    if (user) {
        authContainer.style.display = 'none';
        const appTemplate = document.getElementById('app-template').content.cloneNode(true);
        appContainer.innerHTML = '';
        appContainer.appendChild(appTemplate);
        appContainer.style.display = 'block';
        appContainer.querySelector('#user-email').textContent = user.email;
        initializeAppLogic(user.uid);
    } else {
        authContainer.style.display = 'flex';
        appContainer.style.display = 'none';
        appContainer.innerHTML = '';
        if (productsUnsubscribe) productsUnsubscribe();
    }
});

document.getElementById('show-register').addEventListener('click', e => { e.preventDefault(); document.getElementById('login-form').style.display = 'none'; document.getElementById('register-form').style.display = 'block'; });
document.getElementById('show-login').addEventListener('click', e => { e.preventDefault(); document.getElementById('login-form').style.display = 'block'; document.getElementById('register-form').style.display = 'none'; });

document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('button[type="submit"]');
    setButtonLoading(button, true);
    try {
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        await signInWithEmailAndPassword(auth, email, password);
    } catch(error) {
        showNotification(getAuthErrorMessage(error.code));
    } finally {
        setButtonLoading(button, false);
    }
});

document.getElementById('register-form').addEventListener('submit', async e => {
    e.preventDefault();
    const button = e.target.querySelector('button[type="submit"]');
    setButtonLoading(button, true);
    try {
        const email = document.getElementById('register-email').value;
        const password = document.getElementById('register-password').value;
        await createUserWithEmailAndPassword(auth, email, password);
    } catch(error) {
        showNotification(getAuthErrorMessage(error.code));
    } finally {
        setButtonLoading(button, false);
    }
});

function getAuthErrorMessage(code) {
    switch (code) {
        case 'auth/user-not-found': case 'auth/wrong-password': return 'Correo o contraseña incorrectos.';
        case 'auth/email-already-in-use': return 'Ese correo electrónico ya está en uso.';
        case 'auth/weak-password': return 'La contraseña debe tener al menos 6 caracteres.';
        case 'auth/invalid-email': return 'El correo electrónico no es válido.';
        default: return 'Ocurrió un error. Inténtalo de nuevo.';
    }
}

function getFirestoreErrorMessage(error) {
    console.error("Firestore Error:", error); 
    switch (error.code) {
        case 'permission-denied':
            return 'No tienes permiso para realizar esta acción.';
        case 'unavailable':
            return 'No se pudo conectar a la base de datos. Revisa tu conexión.';
        default:
            return 'Ocurrió un error inesperado en la base de datos.';
    }
}

// --- Lógica Principal de la App ---

function initializeAppLogic(userId) {
    const collectionPath = `users/${userId}/products`;
    const productsCollectionRef = collection(db, collectionPath);
    setupAppEventListeners(productsCollectionRef, userId);
    listenForProducts(productsCollectionRef, userId);
}

// --- Modales ---
function openModal(modalElement) { 
    closeModal(); 
    currentOpenModal = modalElement;
    modalContainer.appendChild(currentOpenModal);
    currentOpenModal.style.display = 'block';
    modalBackdrop.style.display = 'block'; 
}
function closeModal() { 
    if (currentOpenModal) { 
        currentOpenModal.remove(); 
        currentOpenModal = null; 
    } 
    modalBackdrop.style.display = 'none';
}

function showConfirmDialog() {
    return new Promise(resolve => {
        const template = document.getElementById('confirm-dialog-template');
        const dialog = template.content.cloneNode(true).firstElementChild;
        dialog.querySelector('.cancel-btn').onclick = () => { resolve(false); closeModal(); };
        dialog.querySelector('.confirm-delete-btn').onclick = () => { resolve(true); closeModal(); };
        openModal(dialog);
    });
}

// --- Renderizado y Eventos ---

function createProductCard(product, collectionRef, userId) {
    const card = document.createElement('div');
    card.className = 'product-card group bg-white dark:bg-gray-800 rounded-lg shadow-md p-4 flex flex-col justify-between relative';
    const price = typeof product.price === 'number' ? `$${product.price.toFixed(2)}` : 'N/A';
    const searchableContent = [product.name, product.category, product.sku, product.supplier, product.description].join(' ').toLowerCase();
    card.dataset.search = searchableContent;

    card.innerHTML = `
        <div>
            <div class="flex justify-between items-start">
                <span class="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">${product.category || 'Sin Categoría'}</span>
                <div class="relative">
                    <button aria-label="Opciones del producto" class="menu-button text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 focus:outline-none">
                        <i class="fas fa-ellipsis-v"></i>
                    </button>
                    <div class="action-menu absolute right-0 mt-2 w-48 bg-white dark:bg-gray-700 rounded-md shadow-lg z-10 py-1">
                        <a href="#" class="edit-btn block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">Editar</a>
                        <a href="#" class="stock-btn block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">Ajustar Stock</a>
                        <a href="#" class="history-btn block px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600">Ver Historial</a>
                        <a href="#" class="delete-btn block px-4 py-2 text-sm text-red-600 hover:bg-gray-100 dark:hover:bg-gray-600">Eliminar</a>
                    </div>
                </div>
            </div>
            <h2 class="text-lg font-bold mt-2 text-gray-900 dark:text-white">${product.name}</h2>
            <p class="text-sm text-gray-500 dark:text-gray-400">${product.sku || 'Sin SKU'}</p>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-2">${product.description || 'Sin descripción.'}</p>
        </div>
        <div class="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center">
            <div>
                <p class="text-xs text-gray-500">Stock Actual</p>
                <p class="text-2xl font-bold">${product.quantity}</p>
            </div>
            <div class="text-right">
                <p class="text-xs text-gray-500">Precio</p>
                <p class="text-lg font-bold">${price}</p>
            </div>
        </div>
    `;
    
    card.querySelector('.edit-btn').onclick = (e) => { e.preventDefault(); handleEdit(product, collectionRef); };
    card.querySelector('.stock-btn').onclick = (e) => { e.preventDefault(); handleStockAdjust(product, collectionRef); };
    card.querySelector('.history-btn').onclick = (e) => { e.preventDefault(); handleShowHistory(product, userId); };
    card.querySelector('.delete-btn').onclick = async (e) => { e.preventDefault(); await handleDelete(product.id, collectionRef); };
    
    const menuButton = card.querySelector('.menu-button');
    const actionMenu = card.querySelector('.action-menu');
    menuButton.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = actionMenu.style.display === 'block';
        document.querySelectorAll('.action-menu').forEach(m => {
            m.style.display = 'none';
        });
        if (!isVisible) {
            actionMenu.style.display = 'block';
        }
    });

    return card;
}

function setupAppEventListeners(collectionRef, userId) {
    appContainer.querySelector('#logout-btn').onclick = () => signOut(auth);
    appContainer.querySelector('#addProductBtn').onclick = () => handleEdit(null, collectionRef);
    appContainer.querySelector('#searchInput').oninput = e => {
        const searchTerm = e.target.value.toLowerCase().trim();
        appContainer.querySelectorAll('.product-card').forEach(card => {
            card.style.display = card.dataset.search.includes(searchTerm) ? 'flex' : 'none';
        });
    };
    modalBackdrop.onclick = closeModal;
    document.addEventListener('click', () => { 
        document.querySelectorAll('.action-menu').forEach(m => m.style.display = 'none');
    });
}

// --- Lógica CRUD y Operaciones con Firestore ---

function listenForProducts(collectionRef, userId) {
    if (productsUnsubscribe) productsUnsubscribe();
    
    const q = query(collectionRef, orderBy("name"));
    const loader = appContainer.querySelector('#loader');
    const productsGrid = appContainer.querySelector('#productsGrid');
    const noProductsMessage = appContainer.querySelector('#noProductsMessage');

    loader.style.display = 'block';
    productsUnsubscribe = onSnapshot(q, snapshot => {
        loader.style.display = 'none';
        productsGrid.innerHTML = '';
        noProductsMessage.style.display = snapshot.empty ? 'block' : 'none';
        
        snapshot.forEach(doc => {
            const product = { id: doc.id, ...doc.data() };
            productsGrid.appendChild(createProductCard(product, collectionRef, userId));
        });
    }, error => {
        showNotification(getFirestoreErrorMessage(error));
    });
}

function handleEdit(product, collectionRef) {
    const template = document.getElementById('product-modal-template');
    const modalContent = template.content.cloneNode(true);
    const modal = modalContent.firstElementChild;
    const form = modal.querySelector('form');
    const modalTitle = modal.querySelector('#modalTitle');
    const initialStockContainer = modal.querySelector('#initialStockContainer');

    if (product) {
        modalTitle.textContent = 'Editar Producto';
        modal.querySelector('#productId').value = product.id;
        modal.querySelector('#productName').value = product.name || '';
        modal.querySelector('#productCategory').value = product.category || '';
        modal.querySelector('#productSku').value = product.sku || '';
        modal.querySelector('#productPrice').value = product.price || '';
        modal.querySelector('#productSupplier').value = product.supplier || '';
        modal.querySelector('#productDescription').value = product.description || '';
        initialStockContainer.style.display = 'none';
    } else {
        modalTitle.textContent = 'Agregar Producto';
        initialStockContainer.style.display = 'block';
    }
    
    form.onsubmit = async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button[type="submit"]');
        setButtonLoading(button, true);

        const data = {
            name: modal.querySelector('#productName').value,
            category: modal.querySelector('#productCategory').value,
            sku: modal.querySelector('#productSku').value,
            price: parseFloat(modal.querySelector('#productPrice').value) || 0,
            supplier: modal.querySelector('#productSupplier').value,
            description: modal.querySelector('#productDescription').value,
            updatedAt: Timestamp.now()
        };

        try {
            if (product) {
                const productRef = doc(collectionRef, product.id);
                await updateDoc(productRef, data);
                showNotification('Producto actualizado con éxito', 'success');
            } else {
                data.quantity = parseInt(modal.querySelector('#productQuantity').value) || 0;
                data.createdAt = Timestamp.now();
                await addDoc(collectionRef, data);
                showNotification('Producto agregado con éxito', 'success');
            }
            closeModal();
        } catch (error) {
            showNotification(getFirestoreErrorMessage(error));
        } finally {
            setButtonLoading(button, false);
        }
    };

    modal.querySelector('.cancel-btn').onclick = closeModal;
    openModal(modal);
}

async function handleDelete(productId, collectionRef) {
    const confirmed = await showConfirmDialog();
    if (confirmed) {
        try {
            await deleteDoc(doc(collectionRef, productId));
            showNotification('Producto eliminado.', 'success');
        } catch (error) {
            showNotification(getFirestoreErrorMessage(error));
        }
    }
}

function handleStockAdjust(product, collectionRef) {
    const template = document.getElementById('stock-modal-template');
    const modal = template.content.cloneNode(true).firstElementChild;
    const form = modal.querySelector('form');
    modal.querySelector('#stockProductName').textContent = product.name;

    form.onsubmit = async (e) => {
        e.preventDefault();
        const button = e.target.querySelector('button[type="submit"]');
        setButtonLoading(button, true);

        const type = modal.querySelector('#movementType').value;
        const quantityChanged = parseInt(modal.querySelector('#movementQuantity').value);
        const reason = modal.querySelector('#movementReason').value;

        if (isNaN(quantityChanged) || quantityChanged <= 0) {
            showNotification('La cantidad debe ser un número positivo.');
            setButtonLoading(button, false);
            return;
        }

        try {
            const productRef = doc(collectionRef, product.id);
            await runTransaction(db, async (transaction) => {
                const productDoc = await transaction.get(productRef);
                if (!productDoc.exists()) { throw "El documento no existe!"; }
                
                const currentQuantity = productDoc.data().quantity || 0;
                let newQuantity = currentQuantity;
                
                if (type === 'entrada') {
                    newQuantity += quantityChanged;
                } else {
                    if (currentQuantity < quantityChanged) { throw "No hay stock suficiente para esta salida."; }
                    newQuantity -= quantityChanged;
                }

                transaction.update(productRef, { quantity: newQuantity });
                
                const movementsCollectionRef = collection(db, `${productRef.path}/movements`);
                
                const movementData = {
                    type, 
                    quantityChanged, 
                    reason,
                    previousStock: currentQuantity,
                    newQuantity: newQuantity,
                    timestamp: Timestamp.now(),
                };
                transaction.set(doc(movementsCollectionRef), movementData);
            });
            showNotification('Stock actualizado con éxito.', 'success');
            closeModal();
        } catch (error) {
            const errorMessage = typeof error === 'string' ? error : getFirestoreErrorMessage(error);
            showNotification(errorMessage);
        } finally {
            setButtonLoading(button, false);
        }
    };
    modal.querySelector('.cancel-btn').onclick = closeModal;
    openModal(modal);
}

async function handleShowHistory(product, userId) {
    const template = document.getElementById('history-modal-template');
    const modal = template.content.cloneNode(true).firstElementChild;
    modal.querySelector('#historyProductName').textContent = product.name;
    const contentDiv = modal.querySelector('#historyContent');
    
    contentDiv.innerHTML = `
        <table class="w-full text-sm text-left">
            <thead class="text-xs text-gray-700 uppercase bg-gray-50 dark:bg-gray-700 dark:text-gray-400">
                <tr>
                    <th scope="col" class="px-4 py-2">Fecha</th>
                    <th scope="col" class="px-4 py-2">Tipo</th>
                    <th scope="col" class="px-4 py-2">Cant.</th>
                    <th scope="col" class="px-4 py-2">Motivo</th>
                </tr>
            </thead>
            <tbody></tbody>
        </table>
        <div id="loadMoreContainer" class="mt-4 text-center"></div>
    `;

    const tbody = contentDiv.querySelector('tbody');
    const loadMoreContainer = contentDiv.querySelector('#loadMoreContainer');
    modal.querySelector('.cancel-btn').onclick = closeModal;
    openModal(modal);

    const movementsCollectionRef = collection(db, `users/${userId}/products/${product.id}/movements`);
    let lastVisibleDoc = null; 

    const loadMoreHistory = async () => {
        loadMoreContainer.innerHTML = '<i class="fas fa-spinner fa-spin fa-lg text-blue-500"></i>';

        let q = query(movementsCollectionRef, orderBy("timestamp", "desc"), limit(HISTORY_PAGE_SIZE));
        if (lastVisibleDoc) {
            q = query(q, startAfter(lastVisibleDoc));
        }
        
        try {
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty && tbody.rows.length === 0) {
                contentDiv.innerHTML = '<p class="p-4 text-center">No hay movimientos registrados.</p>';
                return;
            }

            querySnapshot.forEach(doc => {
                const item = doc.data();
                const date = item.timestamp.toDate().toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' });
                const typeClass = item.type === 'entrada' ? 'text-green-500' : 'text-red-500';
                const typeText = item.type === 'entrada' ? 'Entrada' : 'Salida';
                const row = tbody.insertRow();
                row.className = 'bg-white border-b dark:bg-gray-800 dark:border-gray-700';
                row.innerHTML = `
                    <td class="px-4 py-2">${date}</td>
                    <td class="px-4 py-2 font-medium ${typeClass}">${typeText}</td>
                    <td class="px-4 py-2 font-bold">${item.quantityChanged}</td>
                    <td class="px-4 py-2">${item.reason}</td>
                `;
            });

            lastVisibleDoc = querySnapshot.docs[querySnapshot.docs.length - 1];
            loadMoreContainer.innerHTML = ''; 

            if (querySnapshot.docs.length === HISTORY_PAGE_SIZE) {
                const loadMoreBtn = document.createElement('button');
                loadMoreBtn.textContent = 'Cargar más';
                loadMoreBtn.className = 'px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700';
                loadMoreBtn.onclick = loadMoreHistory;
                loadMoreContainer.appendChild(loadMoreBtn);
            }
        } catch (error) {
            contentDiv.innerHTML = `<p class="p-4 text-center text-red-500">No se pudo cargar el historial. ${getFirestoreErrorMessage(error)}</p>`;
        }
    };
    
    await loadMoreHistory();
}
