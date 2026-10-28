
const API_URL = "https://zearome-zeamebg.ms.fun";

// ========================================
// 1. EXISTING PAGE ELEMENTS
// ========================================

const photoData = sessionStorage.getItem("uploadeImage");

const preview = document.querySelector("#jiggy");

const thumbnailPreview = document.querySelector("#thumbnail-preview");
const thumbnailPlaceholder = document.querySelector("#thumbnail-placeholder");

const removeButton = document.querySelector("#remove-bg");
const colorInput = document.querySelector("#bg-color");
const replaceButton = document.querySelector("#replace-bg");
const downloadLink = document.querySelector("#download");
const addImageInput = document.querySelector("#well-well");
const compareButton = document.querySelector("#compare-images");

// Keep the original image and selected replacement background.
let originalFile = null;
let replacementFile = null;

// Track generated image URLs so they can be released safely.
let originalPreviewURL = null;
let replacementPreviewURL = null;

// ========================================
// 2. IMAGE CONVERSION AND INITIALIZATION
// ========================================

async function dataURLToFile(dataURL, filename = "image.png") {
    const response = await fetch(dataURL);

    if (!response.ok) {
        throw new Error("Could not read the uploaded image.");
    }

    const blob = await response.blob();

    return new File([blob], filename, {
        type: blob.type || "image/png"
    });
}

async function initializePage() {
    if (!preview) {
        console.error("The image preview #jiggy was not found.");
        return;
    }

    if (!photoData) {
        console.error("No uploaded image was found.");
        alert("No image was found. Please upload an image again.");
        return;
    }

    preview.src = photoData;

    try {
        originalFile = await dataURLToFile(photoData);
    } catch (error) {
        console.error("Could not load the uploaded image:", error);
        alert("Could not load your image. Please upload it again.");
    }
}

// ========================================
// 3. DISPLAY AND DOWNLOAD IMAGE RESULTS
// ========================================


function displayResult(resultURL, filename) {
    if (!preview) return;

    // Release the previous processed result.
    if (preview.dataset.resultUrl) {
        URL.revokeObjectURL(preview.dataset.resultUrl);
    }

    preview.dataset.resultUrl = resultURL;
    preview.src = resultURL;

    // Update the small thumbnail with the latest edited image.
    if (thumbnailPreview) {
        thumbnailPreview.src = resultURL;
        thumbnailPreview.hidden = false;
    }

    if (thumbnailPlaceholder) {
        thumbnailPlaceholder.hidden = true;
    }

    if (downloadLink) {
        downloadLink.href = resultURL;
        downloadLink.download = filename;
        downloadLink.textContent = "Download Image";
        downloadLink.hidden = false;
    }
}


async function processImage(endpoint, extraFields = {}) {
    if (!originalFile) {
        alert("Your image is not ready. Please upload it again.");
        return;
    }

    const formData = new FormData();
    formData.append("file", originalFile);

    for (const [name, value] of Object.entries(extraFields)) {
        formData.append(name, value);
    }

    const previousText = downloadLink
        ? downloadLink.textContent
        : "";

    const buttons = [
        removeButton,
        replaceButton,
        openColorPicker,
        compareButton
    ].filter(Boolean);

    try {
        buttons.forEach(button => {
            button.disabled = true;
        });

        if (downloadLink) {
            downloadLink.textContent = "Processing...";
            downloadLink.hidden = false;
        }

        const response = await fetch(`${API_URL}${endpoint}`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            let message = "Image processing failed.";

            try {
                const errorData = await response.json();
                message = errorData.detail || message;
            } catch {
                // The response wasn't JSON.
            }

            throw new Error(message);
        }

        const resultBlob = await response.blob();

        if (!resultBlob.type.startsWith("image/")) {
            throw new Error("The server did not return a valid image.");
        }

        const resultURL = URL.createObjectURL(resultBlob);

        let filename = "zeamebg-result.png";

        if (endpoint === "/remove-bg") {
            filename = "zeamebg-transparent.png";
        } else if (endpoint === "/replace-color") {
            filename = "zeamebg-color-background.png";
        }

        displayResult(resultURL, filename);

    } catch (error) {
        console.error("Image processing error:", error);

        alert(
            error.message.includes("Failed to fetch")
                ? "Cannot reach the backend. Please check your internet connection or the backend status."
                : error.message
        );

        if (downloadLink) {
            downloadLink.textContent = previousText || "Download Image";
        }
    } finally {
        buttons.forEach(button => {
            button.disabled = false;
        });
    }
}

// ========================================
// 4. REMOVE BACKGROUND
// ========================================


 // ========================================
 // 4. REMOVE BACKGROUND
 // ========================================

 document.querySelectorAll("#remove-bg").forEach(button => {
     button.addEventListener("click", () => {
         processImage("/remove-bg");
     });
 });


// ========================================
// 5. CHANGE BACKGROUND COLOR
// ========================================

const openColorPicker = document.querySelector("#open-color-picker");
const colorModal = document.querySelector("#color-modal");
const closeColorPicker = document.querySelector("#close-color-picker");
const cancelColor = document.querySelector("#cancel-color");
const applyColor = document.querySelector("#apply-color");
const popupColor = document.querySelector("#popup-color");
const colorHex = document.querySelector("#color-hex");

let selectedColor = "#FFFFFF";

function updateSelectedColor(color) {
    selectedColor = color.toUpperCase();

    if (popupColor) popupColor.value = selectedColor;
    if (colorHex) colorHex.value = selectedColor;
    if (colorInput) colorInput.value = selectedColor;
}

function closeColorPopup() {
    if (colorModal) colorModal.hidden = true;
}

if (openColorPicker && colorModal) {
    openColorPicker.addEventListener("click", () => {
        updateSelectedColor(
            colorInput ? colorInput.value : "#FFFFFF"
        );

        colorModal.hidden = false;
    });
}

if (closeColorPicker) {
    closeColorPicker.addEventListener("click", closeColorPopup);
}

if (cancelColor) {
    cancelColor.addEventListener("click", closeColorPopup);
}

if (colorModal) {
    colorModal.addEventListener("click", event => {
        if (event.target === colorModal) {
            closeColorPopup();
        }
    });
}

if (popupColor) {
    popupColor.addEventListener("input", () => {
        updateSelectedColor(popupColor.value);
    });
}

if (colorHex) {
    colorHex.addEventListener("input", () => {
        const value = colorHex.value.trim();

        if (/^#[0-9a-fA-F]{6}$/.test(value)) {
            updateSelectedColor(value);
        }
    });
}

document.querySelectorAll(".swatch").forEach(swatch => {
    swatch.addEventListener("click", () => {
        updateSelectedColor(swatch.dataset.color);
    });
});

if (applyColor) {
    applyColor.addEventListener("click", async () => {
        if (!/^#[0-9a-fA-F]{6}$/.test(selectedColor)) {
            alert("Enter a valid HEX color, such as #5F9D8A.");
            return;
        }

        closeColorPopup();

        await processImage("/replace-color", {
            color: selectedColor
        });
    });
}

// Retain support for changing color through the native color input.
if (colorInput) {
    colorInput.addEventListener("change", () => {
        updateSelectedColor(colorInput.value);

        processImage("/replace-color", {
            color: colorInput.value
        });
    });
}

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && colorModal && !colorModal.hidden) {
        closeColorPopup();
    }
});

// ========================================
// 6. REPLACE BACKGROUND IMAGE
// ========================================

// Create a hidden file input for the replacement background.
const backgroundInput = document.createElement("input");

backgroundInput.type = "file";
backgroundInput.accept = "image/*";
backgroundInput.hidden = true;

document.body.appendChild(backgroundInput);

if (replaceButton) {
    replaceButton.addEventListener("click", () => {
        backgroundInput.click();
    });
}

backgroundInput.addEventListener("change", async () => {
    replacementFile = backgroundInput.files[0];

    if (!replacementFile) return;

    if (!replacementFile.type.startsWith("image/")) {
        alert("Please select a valid background image.");
        backgroundInput.value = "";
        return;
    }

    if (!originalFile) {
        alert("Please upload your main image again.");
        backgroundInput.value = "";
        return;
    }

    const formData = new FormData();

    formData.append("file", originalFile);
    formData.append("background_file", replacementFile);

    try {
        if (replaceButton) replaceButton.disabled = true;

        if (downloadLink) {
            downloadLink.textContent = "Processing...";
            downloadLink.hidden = false;
        }

        const response = await fetch(`${API_URL}/replace-bg`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            let message = "Background replacement failed.";

            try {
                const errorData = await response.json();
                message = errorData.detail || message;
            } catch {
                // The response wasn't JSON.
            }

            throw new Error(message);
        }

        const resultBlob = await response.blob();

        if (!resultBlob.type.startsWith("image/")) {
            throw new Error("The server did not return a valid image.");
        }

        const resultURL = URL.createObjectURL(resultBlob);

        displayResult(
            resultURL,
            "zeamebg-replaced-background.png"
        );

    } catch (error) {
        console.error("Background replacement error:", error);

        alert(
            error.message.includes("Failed to fetch")
                ? "Cannot reach the background-removal server."
                : error.message
        );
    } finally {
        if (replaceButton) replaceButton.disabled = false;
        backgroundInput.value = "";
    }
});

// ========================================
// 7. COMPARE ORIGINAL AND EDITED IMAGES
// ========================================

const compareModal = document.querySelector("#compare-modal");

if (compareButton && compareModal && preview) {
    const beforeImage = compareModal.querySelector(".compare-before");
    const afterImage = compareModal.querySelector(".compare-after");
    const afterWrap = compareModal.querySelector(".compare-after-wrap");
    const divider = compareModal.querySelector(".compare-divider");
    const range = compareModal.querySelector(".compare-range");
    const closeCompareButton = compareModal.querySelector(".compare-close");

    let comparisonOpen = false;

    function updateComparisonSlider() {
        if (!range || !afterWrap || !divider) return;

        const value = Number(range.value);

        afterWrap.style.width = `${value}%`;
        divider.style.left = `${value}%`;
    }

    function sizeComparisonImage() {
        if (!beforeImage || !afterImage) return;

        // Match the edited image's dimensions to the original image.
        afterImage.style.width = `${beforeImage.clientWidth}px`;
        afterImage.style.height = `${beforeImage.clientHeight}px`;
    }

    function closeComparison() {
        compareModal.hidden = true;
        comparisonOpen = false;
        window.removeEventListener("resize", sizeComparisonImage);
    }

    compareButton.addEventListener("click", () => {
        if (!originalFile) {
            alert("Please upload an image first.");
            return;
        }

        const editedURL = preview.dataset.resultUrl;

        if (!editedURL) {
            alert("Process your image first, then compare the results.");
            return;
        }

        // Use the original file and latest processed result.
        const originalURL = URL.createObjectURL(originalFile);

        beforeImage.onload = () => {
            sizeComparisonImage();
            updateComparisonSlider();
        };

        afterImage.onload = () => {
            sizeComparisonImage();
        };

        beforeImage.src = originalURL;
        afterImage.src = editedURL;

        range.value = 50;
        updateComparisonSlider();

        compareModal.hidden = false;
        comparisonOpen = true;

        // Release the temporary original image URL when it is no
        // longer needed by the comparison.
        const cleanupOriginalURL = () => {
            URL.revokeObjectURL(originalURL);
            beforeImage.onload = null;
        };

        beforeImage.addEventListener("load", cleanupOriginalURL, {
            once: true
        });

        window.addEventListener("resize", sizeComparisonImage);
    });

    if (range) {
        range.addEventListener("input", updateComparisonSlider);
    }

    if (closeCompareButton) {
        closeCompareButton.addEventListener("click", closeComparison);
    }

    compareModal.addEventListener("click", event => {
        if (event.target === compareModal) {
            closeComparison();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && comparisonOpen) {
            closeComparison();
        }
    });
}

// ========================================
// 8. UPLOAD A DIFFERENT MAIN IMAGE
// ========================================

if (addImageInput) {
    addImageInput.addEventListener("change", event => {
        const file = event.target.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            alert("Please select a valid image.");
            addImageInput.value = "";
            return;
        }

        // Save the new original image.
        originalFile = file;

        // Display the newly uploaded image.
        const imageURL = URL.createObjectURL(file);

        if (originalPreviewURL) {
            URL.revokeObjectURL(originalPreviewURL);
        }

        originalPreviewURL = imageURL;

        // Clear the old processed result.
        if (preview.dataset.resultUrl) {
            URL.revokeObjectURL(preview.dataset.resultUrl);
            delete preview.dataset.resultUrl;
        }

        preview.src = imageURL;


        // Update the thumbnail when a new image is uploaded.
if (thumbnailPreview) {
    thumbnailPreview.src = imageURL;
    thumbnailPreview.hidden = false;
}

if (thumbnailPlaceholder) {
    thumbnailPlaceholder.hidden = true;
}

        // Hide the old download link.
        if (downloadLink) {
            downloadLink.hidden = true;
            downloadLink.removeAttribute("href");
            downloadLink.textContent = "Download Image";
        }

        // Clear the previous replacement background selection.
        replacementFile = null;
        backgroundInput.value = "";

        if (replacementPreviewURL) {
            URL.revokeObjectURL(replacementPreviewURL);
            replacementPreviewURL = null;
        }
    });
}

// ========================================
// 9. START THE PAGE
// ========================================

initializePage();



/* ========================================
   CROP & RESIZE
======================================== */

(() => {
    const openButton = document.querySelector("#crop-resize");
    const modal = document.querySelector("#crop-modal");
    const stage = document.querySelector("#crop-stage");
    const image = document.querySelector("#crop-image");
    const selection = document.querySelector("#crop-selection");
    const closeButton = document.querySelector("#crop-close");
    const resetButton = document.querySelector("#crop-reset");
    const applyButton = document.querySelector("#crop-apply");
    const ratioSelect = document.querySelector("#crop-ratio");
    const widthInput = document.querySelector("#crop-width");
    const heightInput = document.querySelector("#crop-height");
    const status = document.querySelector("#crop-status");

    if (
        !openButton || !modal || !stage || !image || !selection ||
        !closeButton || !resetButton || !applyButton ||
        !ratioSelect || !widthInput || !heightInput || !status
    ) {
        console.warn("Crop editor elements are missing from remove.html.");
        return;
    }

    let cropRect = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let currentImageURL = null;
    let openingImageURL = null;
    let originalCropImage = null;

    function getBounds() {
        return {
            width: image.clientWidth,
            height: image.clientHeight
        };
    }

    function getPoint(event) {
        const rect = image.getBoundingClientRect();

        return {
            x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            y: Math.max(0, Math.min(rect.height, event.clientY - rect.top))
        };
    }

    function getRatio() {
        const value = ratioSelect.value;

        if (value === "free") return null;

        const [w, h] = value.split(":").map(Number);
        return w / h;
    }

    function fitRect(x, y, endX, endY) {
        const bounds = getBounds();
        let left = Math.min(x, endX);
        let top = Math.min(y, endY);
        let width = Math.abs(endX - x);
        let height = Math.abs(endY - y);
        const ratio = getRatio();

        if (ratio) {
            if (width / Math.max(height, 0.001) > ratio) {
                width = height * ratio;
            } else {
                height = width / ratio;
            }

            if (endX < x) left = x - width;
            if (endY < y) top = y - height;

            left = Math.max(0, Math.min(left, bounds.width - width));
            top = Math.max(0, Math.min(top, bounds.height - height));

            width = Math.min(width, bounds.width - left);
            height = Math.min(height, bounds.height - top);
        }

        return { x: left, y: top, width, height };
    }

    function drawSelection() {
        if (!cropRect) {
            selection.hidden = true;
            return;
        }

        selection.hidden = false;
        selection.style.left = `${cropRect.x}px`;
        selection.style.top = `${cropRect.y}px`;
        selection.style.width = `${cropRect.width}px`;
        selection.style.height = `${cropRect.height}px`;

        status.textContent =
            `Selection: ${Math.round(cropRect.width)} × ` +
            `${Math.round(cropRect.height)} display pixels`;
    }

    function resetSelection() {
        const bounds = getBounds();

        if (!bounds.width || !bounds.height) return;

        const ratio = getRatio();
        let width = bounds.width * 0.8;
        let height = bounds.height * 0.8;

        if (ratio) {
            if (width / height > ratio) {
                width = height * ratio;
            } else {
                height = width / ratio;
            }
        }

        cropRect = {
            x: (bounds.width - width) / 2,
            y: (bounds.height - height) / 2,
            width,
            height
        };

        drawSelection();
    }

    function closeEditor() {
        modal.hidden = true;
        dragging = false;

        if (openingImageURL) {
            URL.revokeObjectURL(openingImageURL);
            openingImageURL = null;
        }

        currentImageURL = null;
        originalCropImage = null;
    }

    openButton.addEventListener("click", async () => {
        if (!preview || !preview.src) {
            alert("Please upload an image first.");
            return;
        }

        openButton.disabled = true;
        status.textContent = "Loading image...";

        try {
            // Use the currently displayed image, including its latest edits.
            const response = await fetch(preview.src);
            const blob = await response.blob();

            if (!blob.type.startsWith("image/")) {
                throw new Error("The current preview is not a valid image.");
            }

            if (openingImageURL) {
                URL.revokeObjectURL(openingImageURL);
            }

            openingImageURL = URL.createObjectURL(blob);
            currentImageURL = openingImageURL;

            image.onload = () => {
                originalCropImage = image;

                modal.hidden = false;

                requestAnimationFrame(() => {
                    resetSelection();
                });
            };

            image.onerror = () => {
                alert("Could not load the image into the crop editor.");
                closeEditor();
            };

            image.src = currentImageURL;
        } catch (error) {
            console.error("Could not open crop editor:", error);
            alert("Could not load the image. Please try again.");
        } finally {
            openButton.disabled = false;
        }
    });

    stage.addEventListener("pointerdown", event => {
        if (modal.hidden || !originalCropImage) return;

        event.preventDefault();

        const point = getPoint(event);

        dragging = true;
        startX = point.x;
        startY = point.y;

        cropRect = {
            x: startX,
            y: startY,
            width: 0,
            height: 0
        };

        stage.setPointerCapture(event.pointerId);
        drawSelection();
    });

    stage.addEventListener("pointermove", event => {
        if (!dragging) return;

        const point = getPoint(event);

        cropRect = fitRect(startX, startY, point.x, point.y);
        drawSelection();
    });

    function stopDragging() {
        dragging = false;

        if (cropRect && (cropRect.width < 2 || cropRect.height < 2)) {
            cropRect = null;
            selection.hidden = true;
            status.textContent = "Drag across the image to select an area.";
        }
    }

    stage.addEventListener("pointerup", stopDragging);
    stage.addEventListener("pointercancel", stopDragging);

    resetButton.addEventListener("click", resetSelection);

    ratioSelect.addEventListener("change", () => {
        resetSelection();
    });

    closeButton.addEventListener("click", closeEditor);

    modal.addEventListener("click", event => {
        if (event.target === modal) closeEditor();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !modal.hidden) {
            closeEditor();
        }
    });

    applyButton.addEventListener("click", () => {
        if (!cropRect || !originalCropImage) {
            alert("Select an area of the image first.");
            return;
        }

        const displayWidth = image.clientWidth;
        const displayHeight = image.clientHeight;

        if (!displayWidth || !displayHeight) {
            alert("The image is not ready. Please try again.");
            return;
        }

        const outputWidth = Number(widthInput.value);
        const outputHeight = Number(heightInput.value);

        if (
            !Number.isInteger(outputWidth) ||
            !Number.isInteger(outputHeight) ||
            outputWidth < 1 || outputHeight < 1 ||
            outputWidth > 10000 || outputHeight > 10000
        ) {
            alert("Enter valid output dimensions between 1 and 10000 pixels.");
            return;
        }

        const scaleX = originalCropImage.naturalWidth / displayWidth;
        const scaleY = originalCropImage.naturalHeight / displayHeight;

        const sx = Math.round(cropRect.x * scaleX);
        const sy = Math.round(cropRect.y * scaleY);
        const sw = Math.round(cropRect.width * scaleX);
        const sh = Math.round(cropRect.height * scaleY);

        if (sw < 1 || sh < 1) {
            alert("Your selection is too small. Select a larger area.");
            return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = outputWidth;
        canvas.height = outputHeight;

        const context = canvas.getContext("2d");

        if (!context) {
            alert("Your browser could not create the cropped image.");
            return;
        }

        context.drawImage(
            originalCropImage,
            sx, sy, sw, sh,
            0, 0, outputWidth, outputHeight
        );

        applyButton.disabled = true;
        applyButton.textContent = "Creating image...";

        canvas.toBlob(blob => {
            applyButton.disabled = false;
            applyButton.textContent = "Apply Crop & Resize";

            if (!blob) {
                alert("Could not create the cropped image.");
                return;
            }

            const resultURL = URL.createObjectURL(blob);

            // Update the main preview and download link.
            if (preview.dataset.resultUrl) {
                URL.revokeObjectURL(preview.dataset.resultUrl);
            }

            preview.dataset.resultUrl = resultURL;
            preview.src = resultURL;



            // Keep the thumbnail synchronized after cropping.
if (thumbnailPreview) {
    thumbnailPreview.src = resultURL;
    thumbnailPreview.hidden = false;
}

if (thumbnailPlaceholder) {
    thumbnailPlaceholder.hidden = true;
}

            if (downloadLink) {
                downloadLink.href = resultURL;
                downloadLink.download = "zeamebg-cropped.png";
                downloadLink.textContent = "Download Image";
                downloadLink.hidden = false;
            }

            closeEditor();
        }, "image/png");
    });
})();

