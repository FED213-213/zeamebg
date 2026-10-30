const API_URL = "https://zearome-zeamebg.ms.fun";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const uploadInput = $("#well-well");
const preview = $("#jiggy");
const downloadLink = $("#download");
const thumbnailList = $("#image-thumbnail-list");

const processingOverlay = $("#processing-overlay");
const processingMessage = $("#processing-message");

let currentImageId = null;
let currentOriginalBlob = null;
let currentResultBlob = null;
let currentOriginalUrl = null;
let replacementBackgroundApplied = false;
let currentResultUrl = null;
let processing = false;
let selectedColor = "#ffffff";
let cropImageUrl = null;
let cropStart = null;
let cropBox = null;
let cropDragging = false;

let activeProcessingController = null;


const cancelActionButton = document.getElementById("cancel-action");
const undoActionButton = document.getElementById("undo-action");
const redoActionButton = document.getElementById("redo-action");

// History for the currently selected image.
let undoHistory = [];
let redoHistory = [];
let historyBusy = false;

function updateHistoryButtons() {
    if (undoActionButton) {
        undoActionButton.hidden = false;
        undoActionButton.disabled =
            processing || historyBusy || undoHistory.length === 0;
    }

    if (redoActionButton) {
        redoActionButton.hidden = false;
        redoActionButton.disabled =
            processing || historyBusy || redoHistory.length === 0;
    }
}

// Save the current image before applying a new edit.
function saveUndoState() {
    if (!currentResultBlob) return;

    undoHistory.push({
        imageId: currentImageId,
        resultBlob: currentResultBlob,
        downloadName: downloadLink?.download || "image-edited.png"
    });

    // A new edit clears the redo history.
    redoHistory = [];

    updateHistoryButtons();
}

function getCurrentHistoryState() {
    return {
        imageId: currentImageId,
        resultBlob: currentResultBlob,
        downloadName: downloadLink?.download || "image-edited.png"
    };
}

// Restore the image preview, download link, and saved image record.
async function restoreHistoryState(state) {
    if (!state?.resultBlob) {
        throw new Error("The image state could not be restored.");
    }

    const newUrl = createObjectUrl(state.resultBlob);

    try {
        if (currentImageId !== null) {
            await updateImageRecord(currentImageId, {
                resultBlob: state.resultBlob,
                updatedAt: Date.now()
            });
        }
    } catch (error) {
        clearObjectUrl(newUrl);
        throw error;
    }

    clearObjectUrl(currentResultUrl);

    currentResultBlob = state.resultBlob;
    currentResultUrl = newUrl;

    if (preview) {
        preview.src = currentResultUrl;
        preview.style.display = "block";
    }

    if (downloadLink) {
        downloadLink.href = currentResultUrl;
        downloadLink.download = state.downloadName;
        downloadLink.hidden = false;
        downloadLink.style.display = "inline-flex";
        downloadLink.style.pointerEvents = "auto";
        downloadLink.style.opacity = "1";
    }
}

// Undo the most recent edit.
async function undoLastAction() {
    if (processing || historyBusy || undoHistory.length === 0) return;

    const previousState = undoHistory[undoHistory.length - 1];

    if (previousState.imageId !== currentImageId) {
        undoHistory = [];
        redoHistory = [];
        updateHistoryButtons();
        return;
    }

    historyBusy = true;
    updateHistoryButtons();

    const currentState = getCurrentHistoryState();

    try {
        await restoreHistoryState(previousState);

        undoHistory.pop();
        redoHistory.push(currentState);
    } catch (error) {
        console.error("Undo failed:", error);
        showMessage("Could not undo the last action. Please try again.");
    } finally {
        historyBusy = false;
        updateHistoryButtons();
    }
}

// Redo the most recently undone edit.
async function redoLastAction() {
    if (processing || historyBusy || redoHistory.length === 0) return;

    const nextState = redoHistory[redoHistory.length - 1];

    if (nextState.imageId !== currentImageId) {
        undoHistory = [];
        redoHistory = [];
        updateHistoryButtons();
        return;
    }

    historyBusy = true;
    updateHistoryButtons();

    const currentState = getCurrentHistoryState();

    try {
        await restoreHistoryState(nextState);

        redoHistory.pop();
        undoHistory.push(currentState);
    } catch (error) {
        console.error("Redo failed:", error);
        showMessage("Could not redo the last action. Please try again.");
    } finally {
        historyBusy = false;
        updateHistoryButtons();
    }
}

undoActionButton?.addEventListener("click", undoLastAction);
redoActionButton?.addEventListener("click", redoLastAction);

updateHistoryButtons();


const DB_STORE = "images";

function openDatabase() {
    return new Promise((resolve, reject) => {
        // Version 1 creates the database for a new visitor.
        // Version 2 also upgrades existing databases missing the store.
        const request = indexedDB.open("ZeameBGImageLibrary", 2);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE, {
                    keyPath: "id"
                });
            }
        };

        request.onsuccess = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.close();
                reject(
                    new Error(
                        'The database opened, but the "images" store is missing.'
                    )
                );
                return;
            }

            resolve(db);
        };

        request.onerror = () => {
            reject(
                request.error ||
                new Error("Could not open the image database.")
            );
        };

        request.onblocked = () => {
            reject(
                new Error(
                    "Database upgrade blocked. Close other tabs of this website and reload."
                )
            );
        };
    });
}





async function saveImageRecord(record) {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        let transaction;

        try {
            transaction = db.transaction(DB_STORE, "readwrite");
            const store = transaction.objectStore(DB_STORE);

            const imageData = {
                ...record,
                id: Date.now() + Math.random()
            };

            console.log("Key path:", store.keyPath);
            console.log("Auto increment:", store.autoIncrement);
            console.log("Saving record:", imageData);

            const request = store.add(imageData);

            request.onsuccess = () => {
                resolve(request.result);
            };

            request.onerror = () => {
                reject(request.error);
            };

            transaction.oncomplete = () => {
                db.close();
            };

            transaction.onerror = () => {
                db.close();
                reject(transaction.error);
            };

            transaction.onabort = () => {
                db.close();
                reject(transaction.error || new Error("Saving image failed."));
            };
        } catch (error) {
            db.close();
            reject(error);
        }
    });
}



async function getImageRecord(id) {
    if (
        id === undefined ||
        id === null ||
        (typeof id === "number" && !Number.isFinite(id)) ||
        !["string", "number", "date"].includes(typeof id)
    ) {
        console.error("Invalid image record ID:", id);
        return null;
    }

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readonly");
        const request = transaction.objectStore(DB_STORE).get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);

        transaction.oncomplete = () => db.close();
        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
        transaction.onabort = () => db.close();
    });
}



async function getAllImageRecords() {
    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readonly");
        const store = transaction.objectStore(DB_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            reject(request.error);
        };

        transaction.oncomplete = () => {
            db.close();
        };

        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
    });
}


async function updateImageRecord(id, updates) {
    const existing = await getImageRecord(id);

    if (!existing) {
        throw new Error("The selected image could not be found.");
    }

    const db = await openDatabase();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction(DB_STORE, "readwrite");
        const store = transaction.objectStore(DB_STORE);

        store.put({
            ...existing,
            ...updates,
            id
        });

        transaction.oncomplete = () => {
            db.close();
            resolve();
        };

        transaction.onerror = () => {
            db.close();
            reject(transaction.error);
        };
    });
}

function createObjectUrl(blob) {
    return blob ? URL.createObjectURL(blob) : null;
}

function clearObjectUrl(url) {
    if (url) {
        URL.revokeObjectURL(url);
    }
}


function setCurrentImage(originalBlob, resultBlob = null, name = "image.png") {
    undoHistory = [];
    redoHistory = [];
    updateHistoryButtons();

    clearObjectUrl(currentOriginalUrl);
    clearObjectUrl(currentResultUrl);

    // Keep the rest of your existing function below this point.

    clearBackgroundCutoutCache();

    currentOriginalBlob = originalBlob;
    currentResultBlob = resultBlob || originalBlob;

    replacementBackgroundApplied = false;

    currentOriginalUrl = createObjectUrl(currentOriginalBlob);
    currentResultUrl = createObjectUrl(currentResultBlob);

    if (preview) {
        preview.src = currentResultUrl;
        preview.style.display = "block";
    }

    if (downloadLink) {
    downloadLink.href = currentResultUrl;
    downloadLink.download =
        name.replace(/\.[^.]+$/, "") + "-edited.png";

    downloadLink.hidden = true;
    downloadLink.style.display = "none";
}
}



function setButtonsDisabled(disabled) {
    processing = disabled;

    $$("#remove-bg, #remove-bg-bottom, #replace-bg, #open-color-picker, #crop-resize, #compare-images")
        .forEach(button => {
            if ("disabled" in button) {
                button.disabled = disabled;
            }

            button.classList.toggle("is-processing", disabled);
        });

        updateHistoryButtons();
}


function showMessage(message) {
    alert(message);
}

async function blobFromFile(file) {
    if (!(file instanceof Blob)) {
        throw new Error("Please select a valid image.");
    }

    return file;
}


async function addThumbnail(file, id) {
    if (!thumbnailList) return;

    const MAX_THUMBNAILS = 10;

    // Remove the oldest thumbnail if the list is already full.
    while (thumbnailList.children.length >= MAX_THUMBNAILS) {
        const oldestThumbnail = thumbnailList.firstElementChild;

        if (!oldestThumbnail) break;

        // Revoke the thumbnail's image URL to avoid memory leaks.
        const oldImage = oldestThumbnail.querySelector("img");

        if (oldImage?.src.startsWith("blob:")) {
            URL.revokeObjectURL(oldImage.src);
        }

        oldestThumbnail.remove();
    }

    const item = document.createElement("button");
    item.type = "button";
    item.className = "image-thumbnail";
    item.imageRecordId = id;
    item.title = file.name || "Uploaded image";

    const image = document.createElement("img");
    image.alt = file.name || "Uploaded image";
    image.src = URL.createObjectURL(file);

    item.appendChild(image);

    item.addEventListener("click", async () => {
        try {
           const record = await getImageRecord(item.imageRecordId);

            if (!record) {
                showMessage("This image could not be loaded.");
                return;
            }

            currentImageId = record.id;
            localStorage.setItem("zeamebg_selected_image_id", String(record.id));

            setCurrentImage(
                record.originalBlob,
                record.resultBlob || record.originalBlob,
                record.name || "image.png"
            );

            // thumbnailList.prepend(item);

// Mark the newly uploaded image as active.
$$(".image-thumbnail").forEach(thumbnail => {
    thumbnail.classList.toggle(
        "active",
        thumbnail === item
    );
});

// Automatically scroll to the newly selected thumbnail.
requestAnimationFrame(() => {
    item.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
    });
});
        } catch (error) {
            console.error(error);
            showMessage("Could not load this image.");
        }
    });

thumbnailList.prepend(item);

// Mark the newly uploaded image as active
$$(".image-thumbnail").forEach(thumbnail => {
    thumbnail.classList.toggle("active", thumbnail === item);
});

// Scroll to show the selected thumbnail
requestAnimationFrame(() => {
    item.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest"
    });
});
}


async function handleFile(file) {
    if (!file || !file.type.startsWith("image/")) {
        showMessage("Please choose a valid image file.");
        return;
    }

    try {
        const blob = await blobFromFile(file);

        const id = await saveImageRecord({
            name: file.name || "image.png",
            originalBlob: blob,
            resultBlob: blob,
            createdAt: Date.now()
        });

        currentImageId = id;
        localStorage.setItem("zeamebg_selected_image_id", String(id));

        setCurrentImage(blob, blob, file.name || "image.png");

        await addThumbnail(file, id);
    } catch (error) {
        console.error(error);
        showMessage("The image could not be loaded. Please try again.");
    }
}

if (uploadInput) {
    uploadInput.addEventListener("change", async event => {
        const file = event.target.files?.[0];

        if (file) {
            await handleFile(file);
        }

        uploadInput.value = "";
    });
}

function getActiveImage() {
    if (!currentOriginalBlob) {
        throw new Error("Upload an image first.");
    }

    return currentResultBlob || currentOriginalBlob;
}

async function getImageFile(entry, useCurrentResult = false) {
    const blob = useCurrentResult
        ? getActiveImage()
        : currentOriginalBlob;

    if (!blob) {
        throw new Error("Upload an image first.");
    }

    return new File(
        [blob],
        entry || "image.png",
        { type: blob.type || "image/png" }
    );
}


async function processImage(endpoint, extraFields = {}, options = {}) {
    if (processing) return;

    processing = true;
    updateHistoryButtons();

    const controller = new AbortController();
    activeProcessingController = controller;


    // Show the processing overlay
    if (processingOverlay) {
    processingOverlay.hidden = false;
    }

    if (processingMessage) {
    const messages = {
        "/remove-bg": "Removing background…",
        "/replace-color": "Changing background colour…",
        "/replace-bg": "Replacing background…"
    };

    processingMessage.textContent =
        messages[endpoint] || "Processing image…";
}

    if (cancelActionButton) {
        cancelActionButton.hidden = false;
    }

    

    const buttons = $$("#remove-bg, #remove-bg-bottom");
    const previousLabels = buttons.map(button => button.innerHTML);

    try {
        setButtonsDisabled(true);

        buttons.forEach(button => {
            button.innerHTML = "Processing...";
        });

        const file = await getImageFile(
            options.fileName || "image.png",
            Boolean(options.useCurrentResult)
        );

        const formData = new FormData();
        formData.append("file", file);

        for (const [key, value] of Object.entries(extraFields)) {
            if (value instanceof Blob) {
                const filename = value instanceof File
                    ? value.name
                    : `${key}.png`;

                formData.append(key, value, filename);
            } else {
                formData.append(key, String(value));
            }
        }

        const response = await fetch(`${API_URL}${endpoint}`, {
            method: "POST",
            body: formData,
            signal: controller.signal
        });

        if (!response.ok) {
            let detail = `Request failed (${response.status}).`;

            try {
                const data = await response.json();
                detail = data.detail || data.message || detail;
            } catch {
                // Keep the default HTTP error message.
            }

            throw new Error(detail);
        }


        // Do not update the image if the request was cancelled.
        if (controller.signal.aborted) return;

        // Read and validate the server's image.
        const resultBlob = await response.blob();

        if (!resultBlob.type.startsWith("image/")) {
            throw new Error("The server did not return a valid image.");
        }

        // Save the previous result for Undo before applying the new one.
        saveUndoState();

        currentResultBlob = resultBlob;

        replacementBackgroundApplied = endpoint === "/replace-bg";

        clearObjectUrl(currentResultUrl);
        currentResultUrl = createObjectUrl(resultBlob);

        if (preview) {
            preview.src = currentResultUrl;
        }

        if (downloadLink) {
            downloadLink.href = currentResultUrl;
            downloadLink.download =
                (options.fileName || "image.png").replace(/\.[^.]+$/, "") +
                "-edited.png";

            downloadLink.removeAttribute("hidden");
            downloadLink.style.display = "inline-flex";
            downloadLink.style.pointerEvents = "auto";
            downloadLink.style.opacity = "1";
        }

        if (currentImageId !== null) {
            await updateImageRecord(currentImageId, {
                resultBlob,
                updatedAt: Date.now()
            });
        }




    } catch (error) {
        if (error.name === "AbortError") {
            console.log("Image processing cancelled.");
        } else {
            console.error(error);
            showMessage(error.message || "Image processing failed.");
        }
    } finally {
        processing = false;

        if (activeProcessingController === controller) {
            activeProcessingController = null;
        }

        if (cancelActionButton) {
            cancelActionButton.hidden = true;
        }

        if (processingOverlay) {
            processingOverlay.hidden = true;
        }

        setButtonsDisabled(false);

        buttons.forEach((button, index) => {
            button.innerHTML =
                previousLabels[index] || "Remove Background";
        });
    }
}





// Cancel button listener — register only once
if (cancelActionButton) {
    cancelActionButton.addEventListener("click", () => {
        if (activeProcessingController) {
            activeProcessingController.abort();
        }
    });
}

/* Remove background */

/* Remove background */


$$('#remove-bg, #remove-bg-bottom').forEach(button => {
    button.addEventListener("click", () => {
        processImage("/remove-bg", {}, {
            fileName: "image.png"
        });
    });
});


/* Color picker modal */

/* =========================
   CUSTOM COLOR PICKER
========================= */


/* Custom color picker */

const colorModal = $("#color-modal");
const colorPicker = $("#bg-color");
const colorHex = $("#color-hex");

const spectrum = $("#color-spectrum");
const marker = $("#color-marker");
const hueInput = $("#color-hue");
const pickerPreview = $("#picker-color-preview");
const pickerHexPreview = $("#picker-hex-preview");

// Temporary live color preview
let colorCutoutSourceBlob = null;
let colorCutoutBlob = null;
let colorCutoutImage = null;
let liveColorPreviewUrl = null;
let colorLivePreviewEnabled = false;
let colorPreviewRenderId = 0;
let colorAtModalOpen = selectedColor;

let pickerHue = 155;
let pickerSaturation = 0;
let pickerBrightness = 1;
let draggingSpectrum = false;

function normalizeHex(value) {
    let hex = String(value || "").trim();

    if (!hex.startsWith("#")) {
        hex = "#" + hex;
    }

    if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
        hex = "#" + hex.slice(1)
            .split("")
            .map(char => char + char)
            .join("");
    }

    return /^#[0-9a-fA-F]{6}$/.test(hex)
        ? hex.toUpperCase()
        : null;
}

function hsvToHex(h, s, v) {
    h = ((Number(h) % 360) + 360) % 360;
    s = Math.max(0, Math.min(1, Number(s)));
    v = Math.max(0, Math.min(1, Number(v)));

    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;

    let r = 0, g = 0, b = 0;

    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];

    return "#" + [r, g, b]
        .map(value => Math.round((value + m) * 255)
            .toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
}

function hexToHsv(hex) {
    hex = normalizeHex(hex);
    if (!hex) return null;

    const [r, g, b] = hex.slice(1).match(/.{2}/g)
        .map(value => parseInt(value, 16) / 255);

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;

    let h = 0;

    if (delta !== 0) {
        if (max === r) h = 60 * (((g - b) / delta) % 6);
        else if (max === g) h = 60 * ((b - r) / delta + 2);
        else h = 60 * ((r - g) / delta + 4);
    }

    if (h < 0) h += 360;

    return {
        h,
        s: max === 0 ? 0 : delta / max,
        v: max
    };
}

function updatePickerAppearance() {
    if (spectrum) {
        spectrum.style.backgroundColor =
            `hsl(${pickerHue}, 100%, 50%)`;
    }

    if (marker) {
        marker.style.left = `${pickerSaturation * 100}%`;
        marker.style.top = `${(1 - pickerBrightness) * 100}%`;
    }

    if (hueInput) hueInput.value = String(pickerHue);

    const color = hsvToHex(
        pickerHue,
        pickerSaturation,
        pickerBrightness
    );

    if (pickerPreview) {
        pickerPreview.style.backgroundColor = color;
    }

    if (pickerHexPreview) {
        pickerHexPreview.textContent = color;
    }
}



let colorCutoutPromise = null;

async function getColorCutout() {
    if (!currentOriginalBlob) {
        throw new Error("Upload an image first.");
    }

    const sourceBlob = currentOriginalBlob;

    // Reuse the transparent cutout if it already exists.
    if (
        colorCutoutSourceBlob === sourceBlob &&
        colorCutoutImage
    ) {
        return colorCutoutImage;
    }

    // Reuse an existing request instead of starting another.
    if (
        colorCutoutSourceBlob === sourceBlob &&
        colorCutoutPromise
    ) {
        return colorCutoutPromise;
    }

    colorCutoutSourceBlob = sourceBlob;

    colorCutoutPromise = (async () => {
        // Reuse a previously removed background when available.
        let cutoutBlob = null;

        if (
            currentResultBlob &&
            currentResultBlob !== sourceBlob &&
            currentResultBlob.type === "image/png"
        ) {
            cutoutBlob = currentResultBlob;
        }

        if (!cutoutBlob) {
            const formData = new FormData();
            formData.append("file", sourceBlob, "image.png");

            const response = await fetch(
                `${API_URL}/remove-bg`,
                {
                    method: "POST",
                    body: formData
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Background removal failed (${response.status}).`
                );
            }

            cutoutBlob = await response.blob();
        }

        const image = await createImageBitmap(cutoutBlob);

        if (colorCutoutSourceBlob !== sourceBlob) {
            image.close();
            throw new Error("The selected image changed.");
        }

        colorCutoutBlob = cutoutBlob;
        colorCutoutImage = image;

        return image;
    })();

    try {
        return await colorCutoutPromise;
    } catch (error) {
        if (colorCutoutSourceBlob === sourceBlob) {
            colorCutoutSourceBlob = null;
        }
        throw error;
    } finally {
        if (colorCutoutSourceBlob === sourceBlob) {
            colorCutoutPromise = null;
        }
    }
}


async function renderLiveColorPreview(color) {
    if (!colorLivePreviewEnabled || !currentOriginalBlob) {
        return;
    }

    const renderId = ++colorPreviewRenderId;

    try {
        const cutout = await getColorCutout();

        // Ignore an outdated render if the user has moved the picker again.
        if (
            renderId !== colorPreviewRenderId ||
            !colorLivePreviewEnabled
        ) {
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = cutout.width;
        canvas.height = cutout.height;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not create the image preview.");
        }

        // Draw the chosen background first.
        context.fillStyle = color;
        context.fillRect(0, 0, canvas.width, canvas.height);

        // Draw the transparent subject over the background.
        context.drawImage(cutout, 0, 0);

        const previewBlob = await new Promise(resolve => {
            canvas.toBlob(resolve, "image/png");
        });

        if (!previewBlob) {
            throw new Error("Could not generate the preview.");
        }

        if (
            renderId !== colorPreviewRenderId ||
            !colorLivePreviewEnabled
        ) {
            return;
        }

        if (liveColorPreviewUrl) {
            URL.revokeObjectURL(liveColorPreviewUrl);
        }

        liveColorPreviewUrl = URL.createObjectURL(previewBlob);

        // Change only the displayed preview, not the saved image data.
        if (preview) {
            preview.src = liveColorPreviewUrl;
        }
    } catch (error) {
        console.error("Live color preview error:", error);
        showMessage(
            "Unable to preview this color. Please try again."
        );
    }
}

function restoreColorPreview() {
    colorLivePreviewEnabled = false;
    colorPreviewRenderId++;

    // Return to the last saved result.
    if (preview && currentResultUrl) {
        preview.src = currentResultUrl;
    }

    if (liveColorPreviewUrl) {
        URL.revokeObjectURL(liveColorPreviewUrl);
        liveColorPreviewUrl = null;
    }

    // Discard the temporary cutout cache.
    if (colorCutoutImage) {
        colorCutoutImage.close();
    }

    colorCutoutImage = null;
    colorCutoutBlob = null;
    colorCutoutSourceBlob = null;
}




function updateSelectedColor(color) {
    const normalized = normalizeHex(color);
    if (!normalized) return false;

    selectedColor = normalized;

    if (colorPicker) colorPicker.value = normalized;
    if (colorHex) colorHex.value = normalized;

    const hsv = hexToHsv(normalized);

    if (hsv) {
        // Preserve the previous hue for white, black, and grey.
        if (hsv.s > 0) {
            pickerHue = hsv.h;
        }

        pickerSaturation = hsv.s;
        pickerBrightness = hsv.v;
    }

    updatePickerAppearance();

    // Update the image preview as the user selects a color.
    if (colorLivePreviewEnabled) {
        renderLiveColorPreview(normalized);
    }

    $$(".swatch").forEach(swatch => {
        swatch.classList.toggle(
            "selected",
            normalizeHex(swatch.dataset.color) === normalized
        );
    });

    return true;
}



function setPickerColorFromPosition(event) {
    if (!spectrum) return;

    const rect = spectrum.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    pickerSaturation = Math.max(
        0,
        Math.min(1, (event.clientX - rect.left) / rect.width)
    );

    pickerBrightness = 1 - Math.max(
        0,
        Math.min(1, (event.clientY - rect.top) / rect.height)
    );

    updateSelectedColor(
        hsvToHex(pickerHue, pickerSaturation, pickerBrightness)
    );
}

spectrum?.addEventListener("pointerdown", event => {
    draggingSpectrum = true;
    spectrum.setPointerCapture(event.pointerId);
    setPickerColorFromPosition(event);
});

spectrum?.addEventListener("pointermove", event => {
    if (draggingSpectrum) setPickerColorFromPosition(event);
});

function stopSpectrumDrag() {
    draggingSpectrum = false;
}

spectrum?.addEventListener("pointerup", stopSpectrumDrag);
spectrum?.addEventListener("pointercancel", stopSpectrumDrag);
spectrum?.addEventListener("lostpointercapture", stopSpectrumDrag);

hueInput?.addEventListener("input", () => {
    pickerHue = Number(hueInput.value);

    updateSelectedColor(
        hsvToHex(pickerHue, pickerSaturation, pickerBrightness)
    );
});

colorHex?.addEventListener("input", event => {
    const normalized = normalizeHex(event.target.value);

    if (normalized) updateSelectedColor(normalized);
});

colorHex?.addEventListener("blur", () => {
    if (!normalizeHex(colorHex.value)) {
        colorHex.value = selectedColor;
    }
});

function openColorModal() {
    if (!colorModal) return;

    colorAtModalOpen = selectedColor;
    colorLivePreviewEnabled = true;

    colorModal.hidden = false;
    colorModal.style.display = "flex";

    updateSelectedColor(selectedColor);
    
}

function closeColorModal() {
    if (!colorModal) return;

    restoreColorPreview();

    colorModal.hidden = true;
    colorModal.style.display = "none";
}
$("#open-color-picker")?.addEventListener("click", openColorModal);
$("#close-color-picker")?.addEventListener("click", closeColorModal);
$("#cancel-color")?.addEventListener("click", closeColorModal);

colorModal?.addEventListener("click", event => {
    if (event.target === colorModal) closeColorModal();
});

$$(".swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
        updateSelectedColor(swatch.dataset.color);
    });
});

$("#apply-color")?.addEventListener("click", async () => {
    const color = normalizeHex(colorHex?.value || selectedColor);

    if (!color) {
        showMessage("Enter a valid HEX color, such as #FFFFFF.");
        return;
    }

    if (!currentOriginalBlob) {
        showMessage("Upload an image before changing its background color.");
        return;
    }

    updateSelectedColor(color);
    closeColorModal();

    await processImage(
        "/replace-color",
        { color },
        { fileName: "image.png" }
    );
});

updateSelectedColor(selectedColor);



/* =========================
   REPLACE BACKGROUND
   UNSPLASH SEARCH + UPLOAD
========================= */

const replaceBgModal = $("#replace-bg-modal");
const backgroundGallery = $("#bg-gallery");
const backgroundCategory = $("#bg-category");
const backgroundSearch = $("#bg-search-input");
const searchBgButton = $("#bg-search-button");
const loadMoreBackgroundsButton = $("#bg-load-more");

const replacementBgInput = $("#replacement-bg-file");
const replacementBgFit = $("#replacement-bg-fit");
const uploadedBgPreview = $("#uploaded-bg-preview");
const uploadedBgImage = $("#uploaded-bg-image");
const uploadedBgName = $("#uploaded-bg-name");
const bgGalleryStatus = $("#bg-gallery-status");

let selectedBackgroundBlob = null;
let selectedBackgroundUrl = null;
let backgroundFitMode = "cover";

let appliedBackgroundType = "original";
let appliedBackgroundColor = "#FFFFFF";



// Live background preview cache
let bgCutoutSourceBlob = null;
let bgCutoutBlob = null;
let bgCutoutPromise = null;
let bgCutoutImage = null;

let bgLivePreviewUrl = null;
let bgPreviewRenderId = 0;
let bgLivePreviewEnabled = false;




async function getBackgroundCutout() {
    if (!currentOriginalBlob) {
        throw new Error("Upload an image first.");
    }

    const sourceBlob = currentOriginalBlob;

    // Reuse the cutout for the same original image.
    if (
        bgCutoutSourceBlob === sourceBlob &&
        bgCutoutImage
    ) {
        return bgCutoutImage;
    }

    // Avoid sending duplicate requests to the backend.
    if (
        bgCutoutSourceBlob === sourceBlob &&
        bgCutoutPromise
    ) {
        return bgCutoutPromise;
    }

    // Invalidate any previous image's cache.
    if (bgCutoutImage) {
        bgCutoutImage.close();
    }

    bgCutoutImage = null;
    bgCutoutBlob = null;
    bgCutoutSourceBlob = sourceBlob;

    bgCutoutPromise = (async () => {
        const formData = new FormData();
        formData.append("file", sourceBlob, "image.png");

        const response = await fetch(`${API_URL}/remove-bg`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            let message = `Background removal failed (${response.status}).`;

            try {
                const data = await response.json();
                message = data.detail || message;
            } catch {}

            throw new Error(message);
        }

        const blob = await response.blob();

        if (!blob.type.startsWith("image/")) {
            throw new Error("The server did not return a valid cutout.");
        }

        const image = await createImageBitmap(blob);

        // The user may have switched images during processing.
        if (bgCutoutSourceBlob !== sourceBlob) {
            image.close();
            throw new Error("The selected image changed.");
        }

        bgCutoutBlob = blob;
        bgCutoutImage = image;

        return image;
    })();

    try {
        return await bgCutoutPromise;
    } catch (error) {
        if (bgCutoutSourceBlob === sourceBlob) {
            bgCutoutSourceBlob = null;
        }

        throw error;
    } finally {
        if (bgCutoutSourceBlob === sourceBlob) {
            bgCutoutPromise = null;
        }
    }
}


async function renderLiveBackgroundPreview() {
    if (
        !bgLivePreviewEnabled ||
        !selectedBackgroundBlob ||
        !currentOriginalBlob
    ) {
        return;
    }

    const renderId = ++bgPreviewRenderId;

    try {
        // Get the foreground with its background removed.
        const cutout = await getBackgroundCutout();

        if (
            renderId !== bgPreviewRenderId ||
            !bgLivePreviewEnabled
        ) {
            return;
        }

        // Load the chosen background.
        const background = await createImageBitmap(
            selectedBackgroundBlob
        );

        if (
            renderId !== bgPreviewRenderId ||
            !bgLivePreviewEnabled
        ) {
            background.close();
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = cutout.width;
        canvas.height = cutout.height;

        const context = canvas.getContext("2d");

        if (!context) {
            background.close();
            throw new Error("Could not create the background preview.");
        }

        const width = canvas.width;
        const height = canvas.height;

        // Match the backend's opaque background canvas.
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);

        const mode = backgroundFitMode;

        if (mode === "stretch") {
            context.drawImage(background, 0, 0, width, height);
        } else if (mode === "contain") {
            const scale = Math.min(
                width / background.width,
                height / background.height
            );

            const drawWidth = background.width * scale;
            const drawHeight = background.height * scale;

            context.drawImage(
                background,
                (width - drawWidth) / 2,
                (height - drawHeight) / 2,
                drawWidth,
                drawHeight
            );
        } else {
            // Cover: fill the canvas and crop excess edges.
            const scale = Math.max(
                width / background.width,
                height / background.height
            );

            const sourceWidth = width / scale;
            const sourceHeight = height / scale;

            const sourceX = (background.width - sourceWidth) / 2;
            const sourceY = (background.height - sourceHeight) / 2;

            context.drawImage(
                background,
                sourceX,
                sourceY,
                sourceWidth,
                sourceHeight,
                0,
                0,
                width,
                height
            );
        }

        // Put the foreground subject over the selected background.
        context.drawImage(cutout, 0, 0);

        background.close();

        const blob = await new Promise((resolve, reject) => {
            canvas.toBlob(result => {
                if (result) {
                    resolve(result);
                } else {
                    reject(new Error("Could not generate the preview."));
                }
            }, "image/png");
        });

        // Ignore results from older selections.
        if (
            renderId !== bgPreviewRenderId ||
            !bgLivePreviewEnabled
        ) {
            return;
        }

        if (bgLivePreviewUrl) {
            URL.revokeObjectURL(bgLivePreviewUrl);
        }

        bgLivePreviewUrl = URL.createObjectURL(blob);

        // Preview only: don't overwrite currentResultBlob here.
        if (preview) {
            preview.src = bgLivePreviewUrl;
        }

    } catch (error) {
        if (renderId === bgPreviewRenderId) {
            console.error("Live background preview error:", error);
            setBackgroundStatus(
                error.message || "Could not preview this background."
            );
        }
    }
}





async function createCompositeForCrop() {
    if (!currentOriginalBlob) {
        throw new Error("No original subject image is available.");
    }

    // Without a replacement background, preserve the current result.
    if (!selectedBackgroundBlob) {
        if (!currentResultBlob) {
            throw new Error("No image result is available to crop.");
        }

        return currentResultBlob;
    }

    // Obtain the transparent subject from the ORIGINAL uploaded image.
    const cutout = await getBackgroundCutout();

    let background = null;

    try {
        background = await createImageBitmap(selectedBackgroundBlob);

        const canvas = document.createElement("canvas");
        canvas.width = cutout.width;
        canvas.height = cutout.height;

        const ctx = canvas.getContext("2d");

        if (!ctx) {
            throw new Error("Could not create the composite image.");
        }

        const width = canvas.width;
        const height = canvas.height;

        // Layer 1: replacement background.
        ctx.clearRect(0, 0, width, height);

        if (backgroundFitMode === "stretch") {
            ctx.drawImage(background, 0, 0, width, height);

        } else if (backgroundFitMode === "contain") {
            const scale = Math.min(
                width / background.width,
                height / background.height
            );

            const drawWidth = background.width * scale;
            const drawHeight = background.height * scale;

            ctx.drawImage(
                background,
                (width - drawWidth) / 2,
                (height - drawHeight) / 2,
                drawWidth,
                drawHeight
            );

        } else {
            // Cover: fill the canvas without distorting the background.
            const scale = Math.max(
                width / background.width,
                height / background.height
            );

            const sourceWidth = width / scale;
            const sourceHeight = height / scale;

            ctx.drawImage(
                background,
                (background.width - sourceWidth) / 2,
                (background.height - sourceHeight) / 2,
                sourceWidth,
                sourceHeight,
                0,
                0,
                width,
                height
            );
        }

        // Layer 2: transparent goblin head.
        // This MUST be drawn after the background.
        ctx.drawImage(cutout, 0, 0, width, height);

        const compositeBlob = await new Promise((resolve, reject) => {
            canvas.toBlob(blob => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(
                        new Error("Could not export the complete image.")
                    );
                }
            }, "image/png");
        });

        console.log("Crop source composite:", {
            width,
            height,
            hasForeground: true,
            hasBackground: true,
            size: compositeBlob.size
        });

        return compositeBlob;

    } finally {
        if (background) {
            background.close();
        }
    }
}






function stopLiveBackgroundPreview() {
    bgLivePreviewEnabled = false;
    bgPreviewRenderId++;

    // Restore the actual saved result in the large preview.
    if (preview && currentResultUrl) {
        preview.src = currentResultUrl;
    }

    if (bgLivePreviewUrl) {
        URL.revokeObjectURL(bgLivePreviewUrl);
        bgLivePreviewUrl = null;
    }
}


function clearBackgroundCutoutCache() {
    if (bgCutoutImage) {
        bgCutoutImage.close();
    }

    bgCutoutImage = null;
    bgCutoutBlob = null;
    bgCutoutPromise = null;
    bgCutoutSourceBlob = null;
}


let backgroundPage = 1;
let backgroundQuery = "";
let backgroundLoading = false;
let backgroundHasMore = false;
let backgroundSearchController = null;
let backgroundSearchVersion = 0;

const backgroundResults = new Map();

/*
Expected backend response:

{
    "results": [
        {
            "id": "photo-id",
            "description": "Beach at sunset",
            "image_url": "https://images.unsplash.com/...",
            "download_location": "https://api.unsplash.com/photos/.../download"
        }
    ],
    "total_pages": 5
}

The backend will be implemented in server.py.
*/

function setBackgroundStatus(message) {
    if (bgGalleryStatus) {
        bgGalleryStatus.textContent = message;
    }
}

function setLoadMoreVisible(visible) {
    if (loadMoreBackgroundsButton) {
        loadMoreBackgroundsButton.hidden = !visible;
    }
}

function revokeSelectedBackgroundUrl() {
    if (selectedBackgroundUrl?.startsWith("blob:")) {
        clearObjectUrl(selectedBackgroundUrl);
    }

    selectedBackgroundUrl = null;
}

function openReplaceBgModal() {
    if (processing) return;

    if (!currentOriginalBlob) {
        showMessage("Upload an image first.");
        return;
    }

    if (!replaceBgModal) {
        showMessage("Replace Background modal HTML is missing.");
        return;
    }

    replaceBgModal.hidden = false;
    replaceBgModal.style.display = "flex";


    bgLivePreviewEnabled = true;

    if (selectedBackgroundBlob) {
    renderLiveBackgroundPreview();
    }



    const gallerySection = $("#bg-gallery-section");
    const uploadSection = $("#bg-upload-section");

    if (gallerySection) gallerySection.hidden = false;
    if (uploadSection) uploadSection.hidden = true;

    $$(".replace-bg-tab").forEach(tab => {
        tab.classList.toggle(
            "active",
            tab.dataset.bgTab === "gallery"
        );
    });

    if (backgroundGallery && !backgroundGallery.children.length) {
        searchBackgrounds(true);
    }
}

function closeReplaceBgModal() {
    if (!replaceBgModal) return;

    stopLiveBackgroundPreview();

    replaceBgModal.hidden = true;
    replaceBgModal.style.display = "none";
}

function selectBackground(blob, url, element = null, metadata = {}) {
    if (!(blob instanceof Blob) || !blob.type.startsWith("image/")) {
        showMessage("The selected background is not a valid image.");
        return;
    }

    revokeSelectedBackgroundUrl();

    selectedBackgroundBlob = blob;
    selectedBackgroundUrl = url || createObjectUrl(blob);

    $$(".bg-gallery-item").forEach(item => {
        item.classList.toggle("selected", item === element);
    });

    if (uploadedBgPreview) {
        uploadedBgPreview.hidden = true;
    }

    if (bgGalleryStatus) {
        bgGalleryStatus.textContent =
            `Selected: ${metadata.name || "Background image"}`;
    }
    renderLiveBackgroundPreview();
}

/* Search and category handling */

function getBackgroundSearchQuery() {
    const query = backgroundSearch?.value.trim() || "";
    const category = backgroundCategory?.value || "all";

    if (query) return query;

    const categoryQueries = {
        all: "beautiful landscape background",
        nature: "nature landscape background",
        beach: "beach ocean background",
        studio: "professional photo studio background",
        office: "modern office interior background",
        city: "city skyline background",
        abstract: "abstract colorful background"
    };

    return categoryQueries[category] || categoryQueries.all;
}

async function searchBackgrounds(reset = true) {
    if (!backgroundGallery || backgroundLoading) return;

    const query = getBackgroundSearchQuery();

    if (!query) {
        setBackgroundStatus("Enter a search term.");
        return;
    }

    if (reset) {
        backgroundSearchVersion++;
        backgroundPage = 1;
        backgroundQuery = query;
        backgroundHasMore = false;

        backgroundSearchController?.abort();
        backgroundSearchController = new AbortController();

        backgroundGallery.innerHTML = "";
        backgroundResults.clear();

        setLoadMoreVisible(false);
    }

    const requestVersion = backgroundSearchVersion;

    backgroundLoading = true;

    if (searchBgButton) searchBgButton.disabled = true;
    if (loadMoreBackgroundsButton) {
        loadMoreBackgroundsButton.disabled = true;
    }

    setBackgroundStatus("Searching backgrounds...");

    try {
        const params = new URLSearchParams({
            query: backgroundQuery,
            page: String(backgroundPage),
            per_page: "12"
        });

        const response = await fetch(
            `${API_URL}/unsplash/search?${params.toString()}`,
            {
                signal: backgroundSearchController?.signal
            }
        );

        if (!response.ok) {
            let message = `Background search failed (${response.status}).`;

            try {
                const data = await response.json();
                message = data.detail || data.message || message;
            } catch {
                // Keep the default error message.
            }

            throw new Error(message);
        }

        const data = await response.json();

        if (requestVersion !== backgroundSearchVersion) return;

        if (!Array.isArray(data.results)) {
            throw new Error("The server returned an invalid background list.");
        }

        data.results.forEach(photo => {
            if (!photo.id || !photo.image_url) return;

            backgroundResults.set(String(photo.id), photo);
            renderBackgroundCard(photo);
        });

        backgroundHasMore =
            backgroundPage < Number(data.total_pages || 1);

        setLoadMoreVisible(backgroundHasMore);

        if (!backgroundGallery.children.length) {
            setBackgroundStatus(
                "No backgrounds found. Try a different search."
            );
        } else {
            setBackgroundStatus(
                `${backgroundResults.size} backgrounds loaded.`
            );
        }
    } catch (error) {
        if (error.name === "AbortError") return;

        console.error("Background search error:", error);

        setBackgroundStatus(
            error.message || "Could not load backgrounds. Please try again."
        );
    

    } finally {
        backgroundLoading = false;

        if (searchBgButton) {
            searchBgButton.disabled = false;
        }

        if (loadMoreBackgroundsButton) {
            loadMoreBackgroundsButton.disabled = false;
        }
    }
}




const backgroundSearchForm = $("#bg-search-form");

if (backgroundSearchForm) {
    backgroundSearchForm.addEventListener("submit", (event) => {
        event.preventDefault();
        searchBackgrounds(true);
    });
}



function renderBackgroundCard(photo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "bg-gallery-item";
    button.dataset.backgroundId = String(photo.id);

    const image = document.createElement("img");
    image.src = photo.image_url;
    image.alt = photo.description || "Unsplash background";
    image.loading = "lazy";
    image.decoding = "async";

    const label = document.createElement("span");
    label.textContent = photo.description || "Background";

    button.append(image, label);

    image.addEventListener("error", () => {
        button.remove();

        if (!backgroundGallery.children.length) {
            setBackgroundStatus(
                "Some images could not be loaded. Try another search."
            );
        }
    });

    button.addEventListener("click", async () => {
        if (processing) return;

        button.disabled = true;
        setBackgroundStatus("Loading selected background...");

        try {
            /*
            Fetch the actual image so it can be sent to
            the existing /replace-bg endpoint.
            */
            const response = await fetch(photo.image_url);

            if (!response.ok) {
                throw new Error("Could not download the selected background.");
            }

            const blob = await response.blob();

            if (!blob.type.startsWith("image/")) {
                throw new Error("The selected background is not a valid image.");
            }

            /*
            Tell the backend which Unsplash photo was selected.
            The backend will implement the tracking endpoint.
            */
            if (photo.download_location) {
                try {
                    const trackingResponse = await fetch(
                        `${API_URL}/unsplash/track-download`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                download_location: photo.download_location
                            })
                        }
                    );

                    if (!trackingResponse.ok) {
    const errorText = await trackingResponse.text();

    console.error(
        "Unsplash download tracking failed:",
        trackingResponse.status,
        errorText
    );
}
                } catch (trackingError) {
                    console.warn(
                        "Could not track the Unsplash download:",
                        trackingError
                    );
                }
            }

            selectBackground(
                blob,
                photo.image_url,
                button,
                { name: photo.description || "Unsplash background" }
            );
        } catch (error) {
            console.error(error);

            setBackgroundStatus(
                error.message || "Could not load this background."
            );
        } finally {
            button.disabled = false;
        }
    });

    backgroundGallery.appendChild(button);
}

/* Search controls */

/* Search controls */

// Search button and Enter are handled by the form submit listener.

backgroundCategory?.addEventListener("change", () => {
    if (backgroundSearch) {
        backgroundSearch.value = "";
    }

    searchBackgrounds(true);
});

loadMoreBackgroundsButton?.addEventListener("click", async () => {
    if (backgroundLoading || !backgroundHasMore) return;

    backgroundPage++;
    await searchBackgrounds(false);
});

/* Open and close the replacement panel */

$("#replace-bg")?.addEventListener("click", openReplaceBgModal);

$("#close-replace-bg")?.addEventListener(
    "click",
    closeReplaceBgModal
);

$("#cancel-replace-bg")?.addEventListener(
    "click",
    closeReplaceBgModal
);

replaceBgModal?.addEventListener("click", event => {
    if (event.target === replaceBgModal) {
        closeReplaceBgModal();
    }
});

/* Gallery and upload tabs */

$$(".replace-bg-tab").forEach(tab => {
    tab.addEventListener("click", () => {
        const selectedTab = tab.dataset.bgTab;

        $$(".replace-bg-tab").forEach(item => {
            item.classList.toggle("active", item === tab);
        });

        const gallerySection = $("#bg-gallery-section");
        const uploadSection = $("#bg-upload-section");

        if (gallerySection) {
            gallerySection.hidden = selectedTab !== "gallery";
        }

        if (uploadSection) {
            uploadSection.hidden = selectedTab !== "upload";
        }
    });
});

/* Upload a custom background */

replacementBgInput?.addEventListener("change", event => {
    const file = event.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        showMessage("Please choose a valid image.");
        replacementBgInput.value = "";
        return;
    }

    revokeSelectedBackgroundUrl();

    selectedBackgroundBlob = file;
    selectedBackgroundUrl = createObjectUrl(file);

    if (uploadedBgImage) {
        uploadedBgImage.src = selectedBackgroundUrl;
    }

    if (uploadedBgName) {
        uploadedBgName.textContent = file.name;
    }

    if (uploadedBgPreview) {
        uploadedBgPreview.hidden = false;
    }

    $$(".bg-gallery-item").forEach(item => {
        item.classList.remove("selected");
    });

    setBackgroundStatus("Your background image is ready.");
    renderLiveBackgroundPreview();

    replacementBgInput.value = "";
});

/* Background fit */

replacementBgFit?.addEventListener("change", event => {
    backgroundFitMode = event.target.value;
    renderLiveBackgroundPreview();
});

/* Apply the selected background */

$("#apply-replace-bg")?.addEventListener("click", async () => {
    if (processing) return;

    if (!selectedBackgroundBlob) {
        showMessage("Choose a background first.");
        return;
    }

    if (!currentOriginalBlob) {
        showMessage("Upload an image first.");
        return;
    }

    const backgroundFile = new File(
        [selectedBackgroundBlob],
        "replacement-background.png",
        {
            type: selectedBackgroundBlob.type || "image/png"
        }
    );

    closeReplaceBgModal();

    await processImage(
        "/replace-bg",
        {
            background_file: backgroundFile,
            fit: backgroundFitMode
        },
        {
            fileName: "image.png"
        }
    );
});

/* Open the background crop editor */

$("#open-bg-crop")?.addEventListener("click", async () => {
    const backgroundRadio = $('input[name="crop-target"][value="background"]');

    if (backgroundRadio) {
        backgroundRadio.checked = true;
    }

    await openCropModal();
});



/* Image comparison */

const compareModal = $("#compare-modal");
const compareBefore = $(".compare-before");
const compareAfter = $(".compare-after");
const compareAfterWrap = $(".compare-after-wrap");
const compareRange = $(".compare-range");
const compareDivider = $(".compare-divider");

let compareImageUrl = null;

function updateComparison(position) {
    const value = Math.max(0, Math.min(100, Number(position)));

    if (compareAfterWrap) {
        compareAfterWrap.style.clipPath = `inset(0 0 0 ${value}%)`;
    }

    if (compareDivider) {
        compareDivider.style.left = `${value}%`;
    }
}

function closeCompareModal() {
    if (!compareModal) return;

    compareModal.hidden = true;
    compareModal.style.display = "none";
}

$("#compare-images")?.addEventListener("click", () => {
    if (!currentOriginalBlob || !currentResultBlob) {
        showMessage("Upload and process an image before comparing.");
        return;
    }

    clearCompareUrls();

   
    const beforeUrl = createObjectUrl(currentOriginalBlob);
    const afterUrl = createObjectUrl(currentResultBlob);

    if (compareBefore) compareBefore.src = beforeUrl;
    if (compareAfter) compareAfter.src = afterUrl;

    compareImageUrl = [beforeUrl, afterUrl];

    if (compareModal) {
        compareModal.hidden = false;
        compareModal.style.display = "flex";
    }

    if (compareRange) {
        compareRange.value = "50";
    }

    updateComparison(50);
});

function clearCompareUrls() {
    if (Array.isArray(compareImageUrl)) {
        compareImageUrl.forEach(clearObjectUrl);
    }

    compareImageUrl = null;
}

$(".compare-close")?.addEventListener("click", () => {
    closeCompareModal();
    clearCompareUrls();
});

compareModal?.addEventListener("click", event => {
    if (event.target === compareModal) {
        closeCompareModal();
        clearCompareUrls();
    }
});

compareRange?.addEventListener("input", event => {
    updateComparison(event.target.value);
});



/* Crop and resize */


/* =========================
   CANVA-STYLE CROP & RESIZE
========================= */

const cropModal = $("#crop-modal");
const cropCanvasImage = $("#crop-image");
const cropStage = $("#crop-stage");
const cropSelection = $("#crop-selection");
const cropRatio = $("#crop-ratio");
const cropWidthInput = $("#crop-width");
const cropHeightInput = $("#crop-height");
const cropStatus = $("#crop-status");
const cropTargetHint = $("#crop-target-hint");

let cropSourceBlob = null;
let cropSourceUrl = null;
let cropSourceImage = null;
let cropPreviewUrl = null;
let cropPreviewRenderId = 0;
let cropPointer = null;
let cropMode = null;

let cropAspect = null;
let cropSyncingInputs = false;

const CROP_MIN_SIZE = 8;

const cropHandles = [
    "nw", "n", "ne",
    "e", "se", "s",
    "sw", "w"
];

function cropTarget() {
    return $('input[name="crop-target"]:checked')?.value
        || "whole-image";
}

function cropImageBounds() {
    if (!cropCanvasImage || !cropStage) return null;

    const imageRect = cropCanvasImage.getBoundingClientRect();
    const stageRect = cropStage.getBoundingClientRect();

    return {
        x: imageRect.left - stageRect.left,
        y: imageRect.top - stageRect.top,
        width: imageRect.width,
        height: imageRect.height
    };
}

function cropClampBox(box) {
    const bounds = cropImageBounds();
    if (!bounds) return box;

    const width = Math.max(
        1,
        Math.min(box.width, bounds.width)
    );

    const height = Math.max(
        1,
        Math.min(box.height, bounds.height)
    );

    return {
        x: Math.max(
            bounds.x,
            Math.min(box.x, bounds.x + bounds.width - width)
        ),
        y: Math.max(
            bounds.y,
            Math.min(box.y, bounds.y + bounds.height - height)
        ),
        width,
        height
    };
}

function cropPoint(event) {
    const bounds = cropImageBounds();

    if (!bounds) return { x: 0, y: 0 };

    const stageRect = cropStage.getBoundingClientRect();

    return {
        x: Math.max(
            bounds.x,
            Math.min(
                event.clientX - stageRect.left,
                bounds.x + bounds.width
            )
        ),
        y: Math.max(
            bounds.y,
            Math.min(
                event.clientY - stageRect.top,
                bounds.y + bounds.height
            )
        )
    };
}

function buildCropHandles() {
    if (!cropSelection) return;

    cropSelection.replaceChildren();

    cropHandles.forEach(position => {
        const handle = document.createElement("button");

        handle.type = "button";
        handle.className = `crop-handle crop-handle-${position}`;
        handle.dataset.handle = position;
        handle.setAttribute(
            "aria-label",
            `Resize crop ${position}`
        );

        cropSelection.appendChild(handle);
    });
}

function updateCropTargetHint() {
    if (!cropTargetHint) return;

    if (cropTarget() === "background") {
        cropTargetHint.textContent =
            "Crop the selected replacement background without cropping the subject. Choose a replacement background first.";
    } else {
        cropTargetHint.textContent =
    "Crop the background independently without cropping the subject.";
    }
}

function cropSetStatus(message) {
    if (cropStatus) cropStatus.textContent = message;
}

function cropOutputSize() {
    if (!cropBox || !cropCanvasImage) return null;

    const bounds = cropImageBounds();

    if (!bounds || !bounds.width || !bounds.height) return null;

    return {
        width: Math.round(
            cropBox.width * cropSourceImage.width / bounds.width
        ),
        height: Math.round(
            cropBox.height * cropSourceImage.height / bounds.height
        )
    };
}

function cropUpdateInputs() {
    if (!cropBox || !cropSourceImage) return;

    const size = cropOutputSize();
    if (!size) return;

    cropSyncingInputs = true;

    if (cropWidthInput) cropWidthInput.value = size.width;
    if (cropHeightInput) cropHeightInput.value = size.height;

    cropSyncingInputs = false;
}

function renderCropSelection() {
    if (!cropSelection || !cropBox) return;

    cropSelection.hidden = false;
    cropSelection.style.display = "block";
    cropSelection.style.left = `${cropBox.x}px`;
    cropSelection.style.top = `${cropBox.y}px`;
    cropSelection.style.width = `${cropBox.width}px`;
    cropSelection.style.height = `${cropBox.height}px`;

    cropUpdateInputs();
    renderCropLivePreview();
}

function cropGetSourceRect() {
    if (!cropBox || !cropSourceImage) return null;

    const bounds = cropImageBounds();
    if (!bounds) return null;

    const x = (cropBox.x - bounds.x) / bounds.width;
    const y = (cropBox.y - bounds.y) / bounds.height;
    const width = cropBox.width / bounds.width;
    const height = cropBox.height / bounds.height;

    const sourceX = Math.max(
        0,
        Math.round(x * cropSourceImage.width)
    );

    const sourceY = Math.max(
        0,
        Math.round(y * cropSourceImage.height)
    );

    const sourceWidth = Math.min(
        cropSourceImage.width - sourceX,
        Math.round(width * cropSourceImage.width)
    );

    const sourceHeight = Math.min(
        cropSourceImage.height - sourceY,
        Math.round(height * cropSourceImage.height)
    );

    if (sourceWidth < 1 || sourceHeight < 1) return null;

    return {
        x: sourceX,
        y: sourceY,
        width: sourceWidth,
        height: sourceHeight
    };
}

async function cropCanvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error("Could not export the cropped image."));
        }, "image/png");
    });
}


function getCropLivePreviewImage() {
    if (!cropStage) return null;

    let image = $("#crop-live-preview");

    if (!image) {
        const panel = document.createElement("div");
        panel.className = "crop-live-preview-panel";
        panel.style.cssText = `
            width: 100%;
            max-width: 320px;
            margin: 12px auto;
            padding: 10px;
            box-sizing: border-box;
            border: 1px solid #ddd;
            border-radius: 10px;
            background: #fff;
            text-align: center;
        `;

        const label = document.createElement("p");
        label.textContent = "Live resize preview";
        label.style.cssText =
            "margin: 0 0 8px; font-weight: 600; color: #222;";

        image = document.createElement("img");
        image.id = "crop-live-preview";
        image.alt = "Live crop and resize preview";
        image.style.cssText = `
            display: block;
            max-width: 100%;
            max-height: 220px;
            width: auto;
            height: auto;
            object-fit: contain;
            margin: auto;
        `;

        panel.append(label, image);
        cropStage.insertAdjacentElement("afterend", panel);
    }

    return image;
}

async function renderCropLivePreview() {
    if (!cropBox || !cropSourceImage) return;

    const renderId = ++cropPreviewRenderId;

    try {
        const rect = cropGetSourceRect();
        if (!rect) return;

        const width = Number(cropWidthInput?.value);
        const height = Number(cropHeightInput?.value);

        const outputWidth =
            Number.isInteger(width) && width >= 1 && width <= 10000
                ? width
                : rect.width;

        const outputHeight =
            Number.isInteger(height) && height >= 1 && height <= 10000
                ? height
                : rect.height;

        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not create the crop preview.");
        }

        context.drawImage(
            cropSourceImage,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            outputWidth,
            outputHeight
        );

        const blob = await cropCanvasToBlob(canvas);

        if (
            renderId !== cropPreviewRenderId ||
            !cropModal ||
            cropModal.hidden
        ) {
            return;
        }

        const newUrl = URL.createObjectURL(blob);
        const oldUrl = cropPreviewUrl;
        cropPreviewUrl = newUrl;

        // Update the dedicated preview inside the crop popup.
        const liveImage = getCropLivePreviewImage();
        if (liveImage) {
            liveImage.src = newUrl;
        }

        // Update the large page preview temporarily for whole-image cropping.
        // Background-only cropping should not replace the main image with
        // a background-only image.
        if (cropTarget() !== "background" && preview) {
            preview.src = newUrl;
        }

        cropSetStatus(
            `Output size: ${outputWidth} × ${outputHeight} px`
        );

        if (oldUrl) {
            URL.revokeObjectURL(oldUrl);
        }
    } catch (error) {
        console.error("Crop preview error:", error);
    }
}


function cropClearPreview() {
    cropPreviewRenderId++;

    if (cropPreviewUrl) {
        URL.revokeObjectURL(cropPreviewUrl);
        cropPreviewUrl = null;
    }

    if (cropCanvasImage) {
        delete cropCanvasImage.dataset.cropPreview;
    }
}


function cropInitialSelection() {
    const bounds = cropImageBounds();
    if (!bounds) return;

    let width = bounds.width;
    let height = bounds.height;

    // If a ratio is selected, create a centered crop
    // with that ratio instead of selecting the whole image.
    if (cropAspect) {
        if (width / height > cropAspect) {
            width = height * cropAspect;
        } else {
            height = width / cropAspect;
        }
    }

    cropBox = {
        x: bounds.x + (bounds.width - width) / 2,
        y: bounds.y + (bounds.height - height) / 2,
        width,
        height
    };

    renderCropSelection();
}



async function createBackgroundOnlyForCrop() {
    if (!currentOriginalBlob) {
        throw new Error("Upload an image first.");
    }

    // A replacement background is already a separate layer.
    if (selectedBackgroundBlob) {
        return selectedBackgroundBlob;
    }

    // If a solid color was applied, recreate that color
    // as a separate background image.
    if (appliedBackgroundType === "color") {
        const original = await createImageBitmap(currentOriginalBlob);

        try {
            const canvas = document.createElement("canvas");
            canvas.width = original.width;
            canvas.height = original.height;

            const ctx = canvas.getContext("2d");
            ctx.fillStyle = appliedBackgroundColor;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            return await cropCanvasToBlob(canvas);
        } finally {
            original.close();
        }
    }

    // No replacement yet: extract the visible original
    // background without including the subject.
    const original = await createImageBitmap(currentOriginalBlob);
    const cutout = await getBackgroundCutout();

    try {
        const canvas = document.createElement("canvas");
        canvas.width = original.width;
        canvas.height = original.height;

        const ctx = canvas.getContext("2d");

        // Start with the original photograph.
        ctx.drawImage(original, 0, 0);

        // Remove the subject's visible area using its alpha.
        const mask = document.createElement("canvas");
        mask.width = canvas.width;
        mask.height = canvas.height;

        const maskCtx = mask.getContext("2d");
        maskCtx.drawImage(
            cutout,
            0,
            0,
            canvas.width,
            canvas.height
        );

        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(mask, 0, 0);
        ctx.globalCompositeOperation = "source-over";

        return await cropCanvasToBlob(canvas);
    } finally {
        original.close();
    }
}




async function openCropModal() {
    if (processing) return;

    if (!currentOriginalBlob) {
        showMessage("Upload an image before cropping.");
        return;
    }

// Display the popup immediately.
if (cropModal) {
    cropModal.hidden = false;
    cropModal.style.display = "flex";
}

cropSetStatus("Preparing image...");

try {
    const target = cropTarget();

        let sourceBlob;

        if (target === "background") {
            sourceBlob = await createBackgroundOnlyForCrop();
        } else {
            sourceBlob = await createCompositeForCrop();
        }

        // Prepare the new image before replacing the old one.
        const sourceImage = await createImageBitmap(sourceBlob);
        const sourceUrl = URL.createObjectURL(sourceBlob);

        cropClearPreview();

        if (cropSourceUrl) {
            URL.revokeObjectURL(cropSourceUrl);
        }

        if (cropSourceImage) {
            cropSourceImage.close();
        }

        cropSourceBlob = sourceBlob;
        cropSourceImage = sourceImage;
        cropSourceUrl = sourceUrl;

        cropBox = null;
        cropAspect = null;

        if (cropRatio) {
            cropRatio.value = "free";
        }

        if (cropModal) {
            cropModal.hidden = false;
            cropModal.style.display = "flex";
        }

        updateCropTargetHint();
        buildCropHandles();

        if (cropCanvasImage) {
            cropCanvasImage.onload = () => {
                requestAnimationFrame(cropInitialSelection);
            };

            cropCanvasImage.src = cropSourceUrl;

            if (
                cropCanvasImage.complete &&
                cropCanvasImage.naturalWidth
            ) {
                requestAnimationFrame(cropInitialSelection);
            }
        }

    } catch (error) {
        console.error("Crop preparation failed:", error);

        showMessage(
            error.message || "Could not prepare the crop editor."
        );
    }
}

function closeCropModal() {
    if (!cropModal) return;

    cropModal.hidden = true;
    cropModal.style.display = "none";

    if (preview) {
    preview.src = bgLivePreviewUrl || currentResultUrl || currentOriginalUrl;
    }
    
    cropClearPreview();

    if (cropSourceUrl) URL.revokeObjectURL(cropSourceUrl);
    cropSourceUrl = null;

    if (cropSourceImage) cropSourceImage.close();
    cropSourceImage = null;

    cropSourceBlob = null;
    cropBox = null;
    cropPointer = null;
    cropMode = null;
}

$("#crop-resize")?.addEventListener("click", openCropModal);
$("#crop-close")?.addEventListener("click", closeCropModal);

cropModal?.addEventListener("click", event => {
    if (event.target === cropModal) closeCropModal();
});

$$('input[name="crop-target"]').forEach(input => {
    input.addEventListener("change", async () => {
        updateCropTargetHint();

        // Reload the correct source when changing crop modes.
        if (cropModal && !cropModal.hidden) {
            await openCropModal();
        }
    });
});

cropSelection?.addEventListener("pointerdown", event => {
    const handle = event.target.closest(".crop-handle");
    if (!cropBox) return;

    event.preventDefault();
    event.stopPropagation();

    cropSelection.setPointerCapture(event.pointerId);

    cropPointer = {
        id: event.pointerId,
        start: cropPoint(event),
        box: { ...cropBox }
    };

    cropMode = handle?.dataset.handle || "move";
});

cropStage?.addEventListener("pointerdown", event => {
    if (event.target.closest(".crop-handle")) return;
    if (event.target === cropSelection) return;
    if (event.target.closest("#crop-selection")) return;
    if (!cropSourceImage) return;

    const bounds = cropImageBounds();
    if (!bounds) return;

    const point = cropPoint(event);

    // Start a new selection only when clicking outside the current one.
    const inside = cropBox &&
        point.x >= cropBox.x &&
        point.x <= cropBox.x + cropBox.width &&
        point.y >= cropBox.y &&
        point.y <= cropBox.y + cropBox.height;

    if (inside) {
        cropPointer = {
            id: event.pointerId,
            start: point,
            box: { ...cropBox }
        };

        cropMode = "move";
    } else {
        cropPointer = {
            id: event.pointerId,
            start: point,
            box: null
        };

        cropMode = "draw";
    }

    cropStage.setPointerCapture(event.pointerId);
});

function cropResizeFromPointer(point) {
    if (!cropPointer) return;

    const bounds = cropImageBounds();
    if (!bounds) return;

    const start = cropPointer.start;
    const original = cropPointer.box;

    if (cropMode === "draw") {
        const x = Math.min(start.x, point.x);
        const y = Math.min(start.y, point.y);

        let width = Math.abs(point.x - start.x);
        let height = Math.abs(point.y - start.y);

        if (cropAspect) {
            if (width / Math.max(height, 1) > cropAspect) {
                height = width / cropAspect;
            } else {
                width = height * cropAspect;
            }
        }

        cropBox = cropClampBox({
            x,
            y,
            width,
            height
        });

        renderCropSelection();
        return;
    }

    if (!original) return;

    if (cropMode === "move") {
        cropBox = cropClampBox({
            ...original,
            x: original.x + point.x - start.x,
            y: original.y + point.y - start.y
        });

        renderCropSelection();
        return;
    }

    let left = original.x;
    let top = original.y;
    let right = original.x + original.width;
    let bottom = original.y + original.height;

    const dx = point.x - start.x;
    const dy = point.y - start.y;

    if (cropMode.includes("w")) left += dx;
    if (cropMode.includes("e")) right += dx;
    if (cropMode.includes("n")) top += dy;
    if (cropMode.includes("s")) bottom += dy;

    left = Math.max(bounds.x, Math.min(left, right - CROP_MIN_SIZE));
    right = Math.min(
        bounds.x + bounds.width,
        Math.max(right, left + CROP_MIN_SIZE)
    );

    top = Math.max(bounds.y, Math.min(top, bottom - CROP_MIN_SIZE));
    bottom = Math.min(
        bounds.y + bounds.height,
        Math.max(bottom, top + CROP_MIN_SIZE)
    );

    if (cropAspect) {
        const width = right - left;
        const height = bottom - top;

        if (Math.abs(dx) >= Math.abs(dy)) {
            const adjustedHeight = width / cropAspect;

            if (cropMode.includes("n")) {
                top = bottom - adjustedHeight;
            } else {
                bottom = top + adjustedHeight;
            }
        } else {
            const adjustedWidth = height * cropAspect;

            if (cropMode.includes("w")) {
                left = right - adjustedWidth;
            } else {
                right = left + adjustedWidth;
            }
        }

        left = Math.max(bounds.x, left);
        top = Math.max(bounds.y, top);
        right = Math.min(bounds.x + bounds.width, right);
        bottom = Math.min(bounds.y + bounds.height, bottom);
    }

    cropBox = cropClampBox({
        x: left,
        y: top,
        width: right - left,
        height: bottom - top
    });

    renderCropSelection();
}

function cropPointerMove(event) {
    if (!cropPointer || event.pointerId !== cropPointer.id) return;

    cropResizeFromPointer(cropPoint(event));
}

function cropPointerUp(event) {
    if (!cropPointer || event.pointerId !== cropPointer.id) return;

    cropPointer = null;
    cropMode = null;
}

cropStage?.addEventListener("pointermove", cropPointerMove);
cropStage?.addEventListener("pointerup", cropPointerUp);
cropStage?.addEventListener("pointercancel", cropPointerUp);

cropSelection?.addEventListener("pointermove", cropPointerMove);
cropSelection?.addEventListener("pointerup", cropPointerUp);
cropSelection?.addEventListener("pointercancel", cropPointerUp);

cropRatio?.addEventListener("change", () => {
    const value = cropRatio.value;

    cropAspect = value === "free"
        ? null
        : (() => {
            const [w, h] = value.split(":").map(Number);
            return w / h;
        })();

    if (cropBox) {
        cropInitialSelection();
    }
});

function cropUpdateFromDimensions(changed) {
    if (cropSyncingInputs || !cropBox || !cropSourceImage) return;

    const width = Number(cropWidthInput?.value);
    const height = Number(cropHeightInput?.value);

    if (
        !Number.isFinite(width) || !Number.isFinite(height) ||
        width < 1 || height < 1
    ) {
        return;
    }

    const bounds = cropImageBounds();
    if (!bounds) return;

    const ratio = cropAspect || width / height;
    const sourceRatio = cropSourceImage.width / cropSourceImage.height;

    let boxWidth = width / cropSourceImage.width * bounds.width;
    let boxHeight = height / cropSourceImage.height * bounds.height;

    if (cropAspect) {
        if (changed === "width") {
            boxHeight = boxWidth / ratio;
        } else {
            boxWidth = boxHeight * ratio;
        }
    }

    const scale = Math.min(
        1,
        bounds.width / Math.max(boxWidth, 1),
        bounds.height / Math.max(boxHeight, 1)
    );

    boxWidth *= scale;
    boxHeight *= scale;

    cropBox = cropClampBox({
        x: bounds.x + (bounds.width - boxWidth) / 2,
        y: bounds.y + (bounds.height - boxHeight) / 2,
        width: boxWidth,
        height: boxHeight
    });

    renderCropSelection();
}



function updateCropPreviewLive() {
    const width = Number(cropWidthInput?.value);
    const height = Number(cropHeightInput?.value);

    if (
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > 10000 ||
        height > 10000
    ) {
        return;
    }

    renderCropLivePreview();
}

cropWidthInput?.addEventListener("input", updateCropPreviewLive);
cropHeightInput?.addEventListener("input", updateCropPreviewLive);



$("#crop-reset")?.addEventListener("click", () => {
    cropBox = null;
    cropInitialSelection();
    cropSetStatus("Selection reset.");
});

$("#crop-apply")?.addEventListener("click", async () => {
    if (!cropBox || !cropSourceImage || !cropSourceBlob) {
        showMessage("Select an area to crop first.");
        return;
    }

    const rect = cropGetSourceRect();

    if (!rect || rect.width < 2 || rect.height < 2) {
        showMessage("Select a larger crop area.");
        return;
    }

    try {
        const canvas = document.createElement("canvas");
        const outputWidth = Math.max(
            1,
            Math.min(10000, Number(cropWidthInput?.value) || rect.width)
        );
        const outputHeight = Math.max(
            1,
            Math.min(10000, Number(cropHeightInput?.value) || rect.height)
        );

        canvas.width = outputWidth;
        canvas.height = outputHeight;

        const context = canvas.getContext("2d");

        if (!context) {
            throw new Error("Could not create the crop canvas.");
        }

        context.drawImage(
            cropSourceImage,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            outputWidth,
            outputHeight
        );

        const croppedBlob = await cropCanvasToBlob(canvas);

if (cropTarget() === "background") {
    // Save only the cropped background.
    selectedBackgroundBlob = croppedBlob;

    revokeSelectedBackgroundUrl();
    selectedBackgroundUrl = URL.createObjectURL(croppedBlob);

    // Update the background thumbnail.
    if (uploadedBgImage) {
        uploadedBgImage.src = selectedBackgroundUrl;
    }

    if (uploadedBgName) {
        uploadedBgName.textContent = "Cropped background";
    }

    if (uploadedBgPreview) {
        uploadedBgPreview.hidden = false;
    }

    // Confirm the background was cropped.
    setBackgroundStatus("Background cropped successfully.");

    // Only update the composite preview if the
    // replacement background editor is open.
    if (bgLivePreviewEnabled) {
        renderLiveBackgroundPreview();
    }
} else {
    // Save the image before applying the crop.
    saveUndoState();

    currentResultBlob = croppedBlob;

            clearObjectUrl(currentResultUrl);
            currentResultUrl = URL.createObjectURL(croppedBlob);

            if (preview) preview.src = currentResultUrl;

            if (downloadLink) {
                downloadLink.href = currentResultUrl;
                downloadLink.download = "zeamebg-cropped.png";
                downloadLink.hidden = false;
                downloadLink.style.display = "inline-flex";
            }

            if (currentImageId !== null) {
                await updateImageRecord(currentImageId, {
                    resultBlob: croppedBlob,
                    updatedAt: Date.now()
                });
            }
        }

        closeCropModal();
    } catch (error) {
        console.error(error);
        showMessage(error.message || "Cropping failed.");
    }
});

window.addEventListener("resize", () => {
    if (cropModal && !cropModal.hidden && cropBox) {
        cropInitialSelection();
    }
});


/* Erase and restore */


const eraseRestoreButton = $("#erase-restore");

let eraseEditor = null;

function createEraseEditor() {
    if (eraseEditor) return eraseEditor;
const panel = $("#erase-editor");

if (!panel) {
    throw new Error("The Erase & Restore panel was not found in remove.html.");
}

    const previewContainer = preview?.parentElement;

    if (!previewContainer) {
        throw new Error("The image preview container was not found.");
    }

    
    const canvas = document.createElement("canvas");
    canvas.className = "erase-brush-canvas";
    canvas.hidden = true;
    previewContainer.appendChild(canvas);

    const editor = {
        panel,
        canvas,
        context: canvas.getContext("2d", { willReadFrequently: false }),
        mode: "erase",
        brushSize: 30,
        softness: 30,
        originalImage: null,
        workingImage: null,
        originalVisibility: "",
        imageId: null,
        drawing: false,
        lastPoint: null,
        restoreMask: null,
        restoreContext: null
    };

    editor.panel.querySelectorAll("[data-mode]").forEach(button => {
        button.addEventListener("click", () => {
            editor.mode = button.dataset.mode;

            editor.panel.querySelectorAll("[data-mode]").forEach(item => {
                item.classList.toggle("active", item === button);
            });
        });
    });

    const sizeInput = panel.querySelector("#erase-brush-size");
    const softnessInput = panel.querySelector("#erase-brush-softness");

    sizeInput.addEventListener("input", () => {
        editor.brushSize = Number(sizeInput.value);
        panel.querySelector("#erase-size-value").textContent =
            sizeInput.value;
    });

    softnessInput.addEventListener("input", () => {
        editor.softness = Number(softnessInput.value);
        panel.querySelector("#erase-softness-value").textContent =
            softnessInput.value;
    });

    panel.querySelector('[data-action="cancel"]').addEventListener(
        "click", () => closeEraseEditor()
    );

    panel.querySelector('[data-action="apply"]').addEventListener(
        "click", () => applyEraseEdits()
    );

    canvas.addEventListener("pointerdown", event => {
        if (processing || !editor.workingImage) return;

        event.preventDefault();
        editor.drawing = true;
        editor.lastPoint = getBrushPoint(event, editor);

        if (editor.mode === "restore") {
            editor.restoreMask = document.createElement("canvas");
            editor.restoreMask.width = canvas.width;
            editor.restoreMask.height = canvas.height;
            editor.restoreContext = editor.restoreMask.getContext("2d");
        }

        canvas.setPointerCapture(event.pointerId);
        paintBrushStamp(editor, editor.lastPoint);
    });

    canvas.addEventListener("pointermove", event => {
        if (!editor.drawing || !editor.lastPoint) return;

        event.preventDefault();

        const point = getBrushPoint(event, editor);
        const dx = point.x - editor.lastPoint.x;
        const dy = point.y - editor.lastPoint.y;

        const distance = Math.hypot(dx, dy);
        const spacing = Math.max(1, editor.brushSize * 0.12);
        const steps = Math.max(1, Math.ceil(distance / spacing));

        for (let i = 1; i <= steps; i++) {
            paintBrushStamp(editor, {
                x: editor.lastPoint.x + dx * i / steps,
                y: editor.lastPoint.y + dy * i / steps
            });
        }

        editor.lastPoint = point;
    });

    function finishStroke() {
        if (!editor.drawing) return;

        editor.drawing = false;
        editor.lastPoint = null;

        if (editor.mode === "restore" && editor.restoreMask) {
            const scratch = document.createElement("canvas");
            scratch.width = canvas.width;
            scratch.height = canvas.height;

            const scratchContext = scratch.getContext("2d");
            scratchContext.drawImage(editor.originalImage, 0, 0);
            scratchContext.globalCompositeOperation = "destination-in";
            scratchContext.drawImage(editor.restoreMask, 0, 0);

            editor.context.globalCompositeOperation = "source-over";
            editor.context.drawImage(scratch, 0, 0);

            editor.restoreMask = null;
            editor.restoreContext = null;
        }

        editor.context.globalCompositeOperation = "source-over";
    }

    canvas.addEventListener("pointerup", finishStroke);
    canvas.addEventListener("pointercancel", finishStroke);
    canvas.addEventListener("lostpointercapture", finishStroke);

    eraseEditor = editor;
    return editor;
}

function getBrushPoint(event, editor) {
    const rect = editor.canvas.getBoundingClientRect();

    return {
        x: (event.clientX - rect.left) *
            editor.canvas.width / rect.width,
        y: (event.clientY - rect.top) *
            editor.canvas.height / rect.height
    };
}

function paintBrushStamp(editor, point) {
    const radius = editor.brushSize *
        (editor.canvas.width / editor.canvas.getBoundingClientRect().width) / 2;

    const ctx = editor.mode === "restore"
        ? editor.restoreContext
        : editor.context;

    if (!ctx) return;

    const softness = editor.softness / 100;
    const innerRadius = radius * (1 - softness);

    const gradient = ctx.createRadialGradient(
        point.x, point.y, innerRadius,
        point.x, point.y, radius
    );

    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.save();

    if (editor.mode === "erase") {
        ctx.globalCompositeOperation = "destination-out";
    } else {
        ctx.globalCompositeOperation = "source-over";
    }

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

function positionEraseCanvas(editor) {
    if (!preview || !editor.canvas) return;

    const imageRect = preview.getBoundingClientRect();
    const containerRect = preview.parentElement.getBoundingClientRect();

    editor.canvas.style.left =
        `${imageRect.left - containerRect.left}px`;
    editor.canvas.style.top =
        `${imageRect.top - containerRect.top}px`;
    editor.canvas.style.width = `${imageRect.width}px`;
    editor.canvas.style.height = `${imageRect.height}px`;
}

async function openEraseEditor() {
    if (processing) {
        showMessage("Wait for image processing to finish first.");
        return;
    }

    if (!currentOriginalBlob || !currentResultBlob || !preview) {
        showMessage("Upload an image before opening Erase & Restore.");
        return;
    }

    try {
        const editor = createEraseEditor();

        if (editor.imageId !== currentImageId) {
            editor.imageId = currentImageId;
        }

        const [originalImage, resultImage] = await Promise.all([
            createImageBitmap(currentOriginalBlob),
            createImageBitmap(currentResultBlob)
        ]);

        editor.originalImage?.close?.();
        editor.workingImage?.close?.();

        editor.originalImage = originalImage;
        editor.workingImage = resultImage;

        editor.canvas.width = resultImage.width;
        editor.canvas.height = resultImage.height;

        editor.context.clearRect(
            0, 0, editor.canvas.width, editor.canvas.height
        );
        editor.context.drawImage(resultImage, 0, 0);

        $("#erase-modal").hidden = false;
        editor.panel.hidden = false;
        editor.canvas.hidden = false;

        editor.originalVisibility = preview.style.visibility;
        preview.style.visibility = "hidden";

        positionEraseCanvas(editor);

        window.addEventListener("resize", editor.onResize ||= () => {
            if (!editor.canvas.hidden) positionEraseCanvas(editor);
        });

    } catch (error) {
        console.error("Could not open Erase & Restore:", error);
        showMessage("Could not open the brush editor. Please try again.");
    }
}

function closeEraseEditor() {
    if (!eraseEditor) return;

    eraseEditor.drawing = false;
    eraseEditor.lastPoint = null;
    eraseEditor.restoreMask = null;
    eraseEditor.restoreContext = null;

    eraseEditor.canvas.hidden = true;
    eraseEditor.panel.hidden = true;
    $("#erase-modal").hidden = true;

    if (preview) {
        preview.style.visibility = eraseEditor.originalVisibility;
    }

    eraseEditor.originalImage?.close?.();
    eraseEditor.workingImage?.close?.();
    eraseEditor.originalImage = null;
    eraseEditor.workingImage = null;
}

async function applyEraseEdits() {
    const editor = eraseEditor;

    if (!editor || !editor.workingImage || processing) return;

    try {
        editor.panel.querySelector('[data-action="apply"]').disabled = true;

        const resultBlob = await new Promise((resolve, reject) => {
            editor.canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error("Could not export the edited image."));
            }, "image/png");
        });

        // Save the previous result so the existing Undo system can restore it.
        saveUndoState();

        currentResultBlob = resultBlob;
        clearObjectUrl(currentResultUrl);
        currentResultUrl = createObjectUrl(resultBlob);

        if (preview) {
            preview.src = currentResultUrl;
        }

        if (downloadLink) {
            downloadLink.href = currentResultUrl;
            downloadLink.download =
                (downloadLink.download || "image.png")
                    .replace(/\.[^.]+$/, "") + "-edited.png";
            downloadLink.hidden = false;
            downloadLink.style.display = "inline-flex";
            downloadLink.style.pointerEvents = "auto";
            downloadLink.style.opacity = "1";
        }

        if (currentImageId !== null) {
            await updateImageRecord(currentImageId, {
                resultBlob,
                updatedAt: Date.now()
            });
        }

        closeEraseEditor();
        showMessage("Erase & Restore edits applied.");
        updateHistoryButtons();

    } catch (error) {
        console.error("Could not apply brush edits:", error);
        showMessage(error.message || "Could not apply the edits.");
    } finally {
        if (editor) {
            editor.panel.querySelector('[data-action="apply"]').disabled = false;
        }
    }
}

eraseRestoreButton?.addEventListener("click", openEraseEditor);


/* Drag-and-drop image upload */

const uploadArea = $(".upload");

if (uploadArea) {
    ["dragenter", "dragover"].forEach(type => {
        uploadArea.addEventListener(type, event => {
            event.preventDefault();
            uploadArea.classList.add("drag-over");
        });
    });

    ["dragleave", "drop"].forEach(type => {
        uploadArea.addEventListener(type, event => {
            event.preventDefault();
            uploadArea.classList.remove("drag-over");
        });
    });

    uploadArea.addEventListener("drop", async event => {
        const file = event.dataTransfer?.files?.[0];

        if (file) {
            await handleFile(file);
        }
    });
}

/* Open the file picker when the upload area is clicked */

uploadArea?.addEventListener("click", event => {
    if (event.target.closest("a")) return;
    if (event.target === uploadInput) return;

    uploadInput?.click();
});

/* Restore an image saved by the previous page session */


async function restorePreviousImage() {
    try {
        const records = await getAllImageRecords();

        // Keep records that contain actual image data.
        const validRecords = records
            .filter(record => record.originalBlob || record.resultBlob)
            .sort((a, b) =>
                (b.updatedAt || b.createdAt || 0) -
                (a.updatedAt || a.createdAt || 0)
            );

        if (validRecords.length > 0) {
            const savedSelectedId = localStorage.getItem(
                "zeamebg_selected_image_id"
            );

            // Restore the previously selected image if it still exists.
            let selectedRecord = validRecords.find(
                record => String(record.id) === savedSelectedId
            );

            // Otherwise, default to the newest saved image.
            if (!selectedRecord) {
                selectedRecord = validRecords[0];
            }

            // Display the newest 10 records.
            let visibleRecords = validRecords.slice(0, 10);

            // Keep the selected image visible, even if it is older.
            if (
                !visibleRecords.some(
                    record => String(record.id) === String(selectedRecord.id)
                )
            ) {
                visibleRecords[visibleRecords.length - 1] = selectedRecord;

                visibleRecords.sort((a, b) =>
                    (b.updatedAt || b.createdAt || 0) -
                    (a.updatedAt || a.createdAt || 0)
                );
            }

            // Clear old thumbnail elements before rebuilding the gallery.
            if (thumbnailList) {
                thumbnailList.replaceChildren();
            }

            // Rebuild thumbnails without relying on addThumbnail()
            // to determine which image is active.
           for (const record of [...visibleRecords].reverse()) {
                const blob = record.originalBlob || record.resultBlob;

                const file = new File(
                    [blob],
                    record.name || "image.png",
                    { type: blob.type || "image/png" }
                );

                await addThumbnail(file, record.id);
            }

            // Explicitly restore the correct active thumbnail.
            $$(".image-thumbnail").forEach(item => {
                item.classList.toggle(
                    "active",
                    String(item.imageRecordId) === String(selectedRecord.id)
                );
            });

            // Restore the same image in the large preview.
            currentImageId = selectedRecord.id;

            localStorage.setItem(
                "zeamebg_selected_image_id",
                String(selectedRecord.id)
            );

            setCurrentImage(
                selectedRecord.originalBlob || selectedRecord.resultBlob,
                selectedRecord.resultBlob || selectedRecord.originalBlob,
                selectedRecord.name || "image.png"
            );

            return;
        }

        // Fallback for an image saved in the previous session mechanism.
        const savedImage = sessionStorage.getItem("uploadeImage");
        if (!savedImage) return;

        const response = await fetch(savedImage);
        if (!response.ok) return;

        const blob = await response.blob();
        if (!blob.type.startsWith("image/")) return;

        const id = await saveImageRecord({
            name: "uploaded-image.png",
            originalBlob: blob,
            resultBlob: blob,
            createdAt: Date.now()
        });

        currentImageId = id;

        localStorage.setItem(
            "zeamebg_selected_image_id",
            String(id)
        );

        setCurrentImage(blob, blob, "uploaded-image.png");

        await addThumbnail(
            new File([blob], "uploaded-image.png", {
                type: blob.type
            }),
            id
        );

        // Ensure the restored thumbnail is active.
        $$(".image-thumbnail").forEach(item => {
            item.classList.toggle(
                "active",
                String(item.imageRecordId) === String(id)
            );
        });

    } catch (error) {
        console.error("Could not restore saved images:", error);
    }
}


if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restorePreviousImage);
} else {
    restorePreviousImage();
}