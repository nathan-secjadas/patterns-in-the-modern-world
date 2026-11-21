
// ==================================
// GALLERY ELEMENTS
// ==================================

const filterButtons = document.querySelectorAll(".filter-btn");
const galleryItems = document.querySelectorAll(".gallery-item");

const imageViewer = document.getElementById("imageViewer");
const selectedImage = document.getElementById("selectedImage");
const imageTitle = document.getElementById("imageTitle");
const imageDescription = document.getElementById("imageDescription");
const imageCategory = document.getElementById("imageCategory");
const imageCounter = document.getElementById("imageCounter");

const closeViewer = document.getElementById("closeViewer");
const prevImage = document.getElementById("prevImage");
const nextImage = document.getElementById("nextImage");

let currentIndex = 0;
let visibleItems = [];


// ==================================
// IMAGE CATEGORY AND TITLE DETECTION
// ==================================

function getImageInformation(img) {

    // Get image filename without extension
    const filename = decodeURIComponent(
        img.getAttribute("src").split("/").pop().split("\\").pop()
    );

    const name = filename.replace(/\.[^/.]+$/, "");

    const lowerName = name.toLowerCase();

    // Available transformations
    const transformations = [
        "translation",
        "reflection",
        "rotation",
        "dilation"
    ];

    let detectedCategories = [];
    let remainingName = lowerName;

    // Detect transformation names at the beginning
    while (remainingName.length > 0) {

        const match = transformations.find(category =>
            remainingName.startsWith(category)
        );

        if (!match) break;

        detectedCategories.push(match);

        remainingName = remainingName.substring(match.length);
    }

    // Fallback if no transformation is detected
    if (detectedCategories.length === 0) {
        detectedCategories.push("other");
        remainingName = lowerName;
    }

    // Remove separators and unnecessary numbering
    let location = name.substring(
        lowerName.length - remainingName.length
    );

    location = location
        .replace(/\.[^/.]+$/, "")
        .replace(/\(\d+\)/g, "")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    // Capitalize location name
    location = location.replace(/\b\w/g, letter =>
        letter.toUpperCase()
    );

    const categoryLabels = detectedCategories.map(category =>
        category.charAt(0).toUpperCase() + category.slice(1)
    );

    // Generate image title
    let title = categoryLabels.join(" + ") + " Pattern";

    if (location) {
        title += " - " + location;
    }

    // Generate category description
    const descriptions = {
        translation:
            "A pattern created by moving a shape from one position to another without changing its size, shape, or orientation.",

        reflection:
            "A pattern created by flipping a shape across a line, producing a mirror image.",

        rotation:
            "A pattern formed by turning a shape around a fixed point at a specific angle.",

        dilation:
            "A pattern created by enlarging or reducing a shape while maintaining its proportions.",

        other:
            "A geometric pattern demonstrating transformations in the modern world."
    };

    const description = detectedCategories
        .map(category => descriptions[category])
        .join(" ");

    return {
        category: detectedCategories.join(" "),
        categoryLabel: categoryLabels.join(" + "),
        title: title,
        description: description
    };
}


// ==================================
// AUTOMATICALLY UPDATE GALLERY DATA
// ==================================

galleryItems.forEach(item => {

    const img = item.querySelector("img");

    const info = getImageInformation(img);

    // Update HTML data attributes
    item.dataset.category = info.category;
    item.dataset.title = info.title;
    item.dataset.description = info.description;

});


// ==================================
// FILTER GALLERY
// ==================================

function filterGallery(filter) {

    galleryItems.forEach(item => {

        const categories = item.dataset.category.split(" ");

        const matches =
            filter === "all" || categories.includes(filter);

        item.style.display = matches ? "" : "none";

    });

    // Update currently visible images
    visibleItems = Array.from(galleryItems).filter(item =>
        item.style.display !== "none"
    );

}


// Initial gallery
filterGallery("all");


filterButtons.forEach(button => {

    button.addEventListener("click", () => {

        filterButtons.forEach(btn =>
            btn.classList.remove("active")
        );

        button.classList.add("active");

        const filter = button.dataset.filter;

        filterGallery(filter);

    });

});


// ==================================
// IMAGE VIEWER
// ==================================

function showImage(index) {

    if (visibleItems.length === 0) return;

    // Loop through images
    if (index < 0) {
        index = visibleItems.length - 1;
    }

    if (index >= visibleItems.length) {
        index = 0;
    }

    currentIndex = index;

    const item = visibleItems[currentIndex];
    const img = item.querySelector("img");

    const info = getImageInformation(img);

    // Display selected image
    selectedImage.src = img.src;
    selectedImage.alt = info.title;

    // Display automatically generated information
    imageTitle.textContent = info.title;
    imageDescription.textContent = info.description;
    imageCategory.textContent = info.categoryLabel.toUpperCase();

    // Update image counter
    imageCounter.textContent =
        String(currentIndex + 1).padStart(2, "0") +
        " / " +
        String(visibleItems.length).padStart(2, "0");

}


// ==================================
// OPEN IMAGE VIEWER
// ==================================

galleryItems.forEach(item => {

    item.addEventListener("click", () => {

        visibleItems = Array.from(galleryItems).filter(item =>
            item.style.display !== "none"
        );

        const index = visibleItems.indexOf(item);

        showImage(index);

        imageViewer.classList.add("active");
        imageViewer.setAttribute("aria-hidden", "false");

        document.body.style.overflow = "hidden";

    });

});


// ==================================
// PREVIOUS AND NEXT BUTTONS
// ==================================

nextImage.addEventListener("click", () => {
    showImage(currentIndex + 1);
});

prevImage.addEventListener("click", () => {
    showImage(currentIndex - 1);
});


// ==================================
// CLOSE IMAGE VIEWER
// ==================================

function closeImageViewer() {

    imageViewer.classList.remove("active");
    imageViewer.setAttribute("aria-hidden", "true");

    document.body.style.overflow = "";

}

closeViewer.addEventListener("click", closeImageViewer);


// Close when clicking outside the viewer window
imageViewer.addEventListener("click", event => {

    if (event.target === imageViewer) {
        closeImageViewer();
    }

});


// ==================================
// KEYBOARD NAVIGATION
// ==================================

document.addEventListener("keydown", event => {

    if (!imageViewer.classList.contains("active")) return;

    if (event.key === "ArrowRight") {
        showImage(currentIndex + 1);
    }

    if (event.key === "ArrowLeft") {
        showImage(currentIndex - 1);
    }

    if (event.key === "Escape") {
        closeImageViewer();
    }

});
