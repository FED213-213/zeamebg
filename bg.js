
const imageInput = document.querySelector("#image-input");

imageInput.addEventListener("change", function () {
    const file = imageInput.files[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
        alert("Please select a valid image.");
        return;
    }

    const reader = new FileReader();

    reader.onload = function () {
        try {
            sessionStorage.setItem("uploadeImage", reader.result);
            window.location.href = "./remove.html";
        } catch (error) {
            alert("Image is too large for temporary storage.");
            console.error(error);
        }
    };

    reader.readAsDataURL(file);
});
