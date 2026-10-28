
const API_URL = "http://127.0.0.1:8000";

// Existing page elements
const photoData = sessionStorage.getItem("uploadeImage");
const preview = document.querySelector("#jiggy");
const removeButton = document.querySelector("#remove-bg");
const colorInput = document.querySelector("#bg-color");
const replaceButton = document.querySelector("#replace-bg");
const downloadLink = document.querySelector("#download");

// Keep the original image so each operation starts from it.
let originalFile = null;
let replacementFile = null;

// Create a file from the image saved by the homepage.
async function dataURLToFile(dataURL, filename = "image.png") {
    const response = await fetch(dataURL);
    const blob = await response.blob();

    return new File([blob], filename, {
        type: blob.type || "image/png"
    });
}

// Display the original uploaded image.
async function initializePage() {
    if (!photoData || !preview) {
        console.error("Image data or preview element is missing.");
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

// Send an image to the backend and display its result.
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

    const previousText = downloadLink.textContent;

    try {
        if (removeButton) removeButton.disabled = true;
        if (replaceButton) replaceButton.disabled = true;

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
                // The server did not return JSON.
            }

            throw new Error(message);
        }

        const resultBlob = await response.blob();
        const resultURL = URL.createObjectURL(resultBlob);

        // Release the previous generated result URL.
        if (preview.dataset.resultUrl) {
            URL.revokeObjectURL(preview.dataset.resultUrl);
        }

        preview.dataset.resultUrl = resultURL;
        preview.src = resultURL;

        if (downloadLink) {
            downloadLink.href = resultURL;
            downloadLink.download =
                endpoint === "/remove-bg"
                    ? "zeamebg-transparent.png"
                    : "zeamebg-result.png";

            downloadLink.textContent = "Download Image";
            downloadLink.hidden = false;
        }
    } catch (error) {
        console.error("Image processing error:", error);

        alert(
            error.message.includes("Failed to fetch")
                ? "Cannot reach the backend. Make sure your FastAPI server is running."
                : error.message
        );

        if (downloadLink) {
            downloadLink.textContent = previousText || "Download Image";
        }
    } finally {
        if (removeButton) removeButton.disabled = false;
        if (replaceButton) replaceButton.disabled = false;
    }
}

// REMOVE BACKGROUND
if (removeButton) {
    removeButton.addEventListener("click", () => {
        processImage("/remove-bg", { format: "png" });
    });
}

// CHANGE BACKGROUND COLOR

const openColorPicker = document.querySelector("#open-color-picker");
const colorModal = document.querySelector("#color-modal");
const closeColorPicker = document.querySelector("#close-color-picker");
const cancelColor = document.querySelector("#cancel-color");
const applyColor = document.querySelector("#apply-color");
const popupColor = document.querySelector("#popup-color");
const colorHex = document.querySelector("#color-hex");
const originalColorInput = document.querySelector("#bg-color");

let selectedColor = "#FFFFFF";

function updateSelectedColor(color) {
    selectedColor = color.toUpperCase();
    popupColor.value = selectedColor;
    colorHex.value = selectedColor;
    originalColorInput.value = selectedColor;
}

// Open popup
openColorPicker.addEventListener("click", () => {
    updateSelectedColor(originalColorInput.value || "#FFFFFF");
    colorModal.hidden = false;
});

// Close popup
function closePopup() {
    colorModal.hidden = true;
}

closeColorPicker.addEventListener("click", closePopup);
cancelColor.addEventListener("click", closePopup);

// Click outside the panel to close it
colorModal.addEventListener("click", (event) => {
    if (event.target === colorModal) {
        closePopup();
    }
});

// Choose a color with the native color selector
popupColor.addEventListener("input", () => {
    updateSelectedColor(popupColor.value);
});

// Type a HEX code
colorHex.addEventListener("input", () => {
    const value = colorHex.value.trim();

    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        updateSelectedColor(value);
    }
});

// Preset color buttons
document.querySelectorAll(".swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
        updateSelectedColor(swatch.dataset.color);
    });
});

// Apply the chosen color using your existing backend function
applyColor.addEventListener("click", async () => {
    if (!/^#[0-9a-fA-F]{6}$/.test(selectedColor)) {
        alert("Please enter a valid HEX color, such as #5F9D8A.");
        return;
    }

    closePopup();

    await processImage("/replace-color", {
        color: selectedColor
    });
});

// Close popup with Escape
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !colorModal.hidden) {
        closePopup();
    }
});


// Your HTML currently uses a label for the color picker.
// This lets the user click the Change Color label to process the image.
const colorLabel = document.querySelector('label[for="bg-color"]');

if (colorLabel) {
    colorLabel.addEventListener("click", (event) => {
        // Allow the color picker to open normally.
        // Processing happens after the color has been selected.
    });
}

if (colorInput) {
    colorInput.addEventListener("change", () => {
        processImage("/replace-color", {
            color: colorInput.value
        });
    });
}

// REPLACE BACKGROUND IMAGE
// This input is created by JavaScript, so you don't need to add it to HTML.
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
        return;
    }

    const formData = new FormData();
    formData.append("file", originalFile);
    formData.append("background_file", replacementFile);

    try {
        if (replaceButton) replaceButton.disabled = true;

        const response = await fetch(`${API_URL}/replace-bg`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) {
            let message = "Background replacement failed.";

            try {
                const errorData = await response.json();
                message = errorData.detail || message;
            } catch {}

            throw new Error(message);
        }

        const resultBlob = await response.blob();
        const resultURL = URL.createObjectURL(resultBlob);

        if (preview.dataset.resultUrl) {
            URL.revokeObjectURL(preview.dataset.resultUrl);
        }

        preview.dataset.resultUrl = resultURL;
        preview.src = resultURL;

        if (downloadLink) {
            downloadLink.href = resultURL;
            downloadLink.download = "zeamebg-replaced-background.png";
            downloadLink.textContent = "Download Image";
            downloadLink.hidden = false;
        }
    } catch (error) {
        console.error("Background replacement error:", error);
        alert(error.message);
    } finally {
        if (replaceButton) replaceButton.disabled = false;
        backgroundInput.value = "";
    }
});

// Initialize the page.
initializePage();

const addImageInput = document.querySelector("#well-well");

addImageInput.addEventListener("change", function () {
    const file = addImageInput.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please select a valid image.");
        addImageInput.value = "";
        return;
    }

    // Update the file used by Remove BG and other actions
    originalFile = file;

    // Display the newly selected image
    const imageURL = URL.createObjectURL(file);

    if (preview.dataset.resultUrl) {
        URL.revokeObjectURL(preview.dataset.resultUrl);
        delete preview.dataset.resultUrl;
    }

    preview.src = imageURL;
    preview.dataset.addedImageUrl = imageURL;

    // Hide the previous download until the new image is processed
    if (downloadLink) {
        downloadLink.hidden = true;
        downloadLink.removeAttribute("href");
    }
});
