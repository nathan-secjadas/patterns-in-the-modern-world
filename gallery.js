
const filterButtons = document.querySelectorAll(".filter-btn");
const galleryItems = document.querySelectorAll(".gallery-item");

// IMAGE VIEWER ELEMENTS
const imageViewer = document.getElementById("imageViewer");
const viewerWindow = imageViewer.querySelector(".viewer-window");

const selectedImage = document.getElementById("selectedImage");

const imageTitle = document.getElementById("imageTitle");
const imageDescription = document.getElementById("imageDescription");
const imageCategory = document.getElementById("imageCategory");

const imageCounter = document.getElementById("imageCounter");

const closeViewer = document.getElementById("closeViewer");
const prevImage = document.getElementById("prevImage");
const nextImage = document.getElementById("nextImage");

let currentIndex = 0;
let lastFocusedElement = null;


// ========================================
// GET ITEM CATEGORIES
// ========================================

// Get all categories assigned to a gallery item
function getItemCategories(item) {

    // Supports multiple categories separated by spaces
    // Also supports the old data-category attribute
    const categories =
        item.dataset.categories ||
        item.dataset.category ||
        "";

    return categories
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(category => category !== "");

}


// ========================================
// GALLERY FILTER
// ========================================

filterButtons.forEach(button => {

    button.addEventListener("click", () => {

        // Update active filter button
        filterButtons.forEach(btn => {
            btn.classList.remove("active");
        });

        button.classList.add("active");

        const filter = button.dataset.filter.toLowerCase();

        // Filter gallery images
        galleryItems.forEach(item => {

            const categories = getItemCategories(item);

            // Show item if it belongs to the selected category
            const matchesFilter =
                filter === "all" ||
                categories.includes(filter);

            item.classList.toggle("hide", !matchesFilter);

        });

    });

});


// ========================================
// IMAGE VIEWER
// ========================================

// Get only currently visible images
function getVisibleItems() {

    return Array.from(galleryItems).filter(item => {
        return !item.classList.contains("hide");
    });

}


// Display selected image
function showImage() {

    const visibleItems = getVisibleItems();

    if (visibleItems.length === 0) return;

    // Keep index within available images
    currentIndex =
        (currentIndex + visibleItems.length) % visibleItems.length;

    const item = visibleItems[currentIndex];
    const img = item.querySelector("img");

    // Display image
    selectedImage.src = img.currentSrc || img.src;
    selectedImage.alt = img.alt || "Selected gallery image";

    // Display title and description
    imageTitle.textContent =
        item.dataset.title || "Untitled Pattern";

    imageDescription.textContent =
        item.dataset.description || "No description available.";

    // Display all categories assigned to the image
    const categories = getItemCategories(item);

    imageCategory.textContent = categories.length > 0
        ? categories.map(category =>
            category.charAt(0).toUpperCase() + category.slice(1)
          ).join(" / ")
        : "Uncategorized";

    // Update image counter
    imageCounter.textContent =
        `${String(currentIndex + 1).padStart(2, "0")} / ${String(visibleItems.length).padStart(2, "0")}`;

    // Hide arrows if there is only one image
    const hasMultipleImages = visibleItems.length > 1;

    prevImage.hidden = !hasMultipleImages;
    nextImage.hidden = !hasMultipleImages;

}


// ========================================
// OPEN IMAGE VIEWER
// ========================================

galleryItems.forEach(item => {

    item.addEventListener("click", () => {

        const visibleItems = getVisibleItems();

        currentIndex = visibleItems.indexOf(item);

        if (currentIndex < 0) return;

        lastFocusedElement = document.activeElement;

        showImage();

        imageViewer.classList.add("active");

        imageViewer.setAttribute("aria-hidden", "false");

        document.body.classList.add("viewer-open");

        closeViewer.focus();

    });

});


// ========================================
// NEXT AND PREVIOUS BUTTONS
// ========================================

// Next image
nextImage.addEventListener("click", () => {

    currentIndex++;

    showImage();

});


// Previous image
prevImage.addEventListener("click", () => {

    currentIndex--;

    showImage();

});


// ========================================
// CLOSE IMAGE VIEWER
// ========================================

function hideViewer() {

    imageViewer.classList.remove("active");

    imageViewer.setAttribute("aria-hidden", "true");

    document.body.classList.remove("viewer-open");

    if (lastFocusedElement) {
        lastFocusedElement.focus();
    }

}


// Close button
closeViewer.addEventListener("click", hideViewer);


// Close when clicking outside the viewer window
imageViewer.addEventListener("click", event => {

    if (event.target === imageViewer) {
        hideViewer();
    }

});


// ========================================
// KEYBOARD CONTROLS
// ========================================

document.addEventListener("keydown", event => {

    const viewerIsOpen =
        imageViewer.classList.contains("active");

    if (!viewerIsOpen) return;

    // Close using ESC
    if (event.key === "Escape") {

        hideViewer();

    }

    // Next image using right arrow
    else if (event.key === "ArrowRight") {

        event.preventDefault();

        currentIndex++;

        showImage();

    }

    // Previous image using left arrow
    else if (event.key === "ArrowLeft") {

        event.preventDefault();

        currentIndex--;

        showImage();

    }

});


// Prevent clicks inside viewer window from closing it
viewerWindow.addEventListener("click", event => {

    event.stopPropagation();

});
