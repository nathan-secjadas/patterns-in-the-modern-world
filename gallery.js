const filterButtons = document.querySelectorAll(".filter-btn");
const galleryItems = document.querySelectorAll(".gallery-item");

filterButtons.forEach(button => {
    button.addEventListener("click", () => {

        // Remove active class from all buttons
        filterButtons.forEach(btn => {
            btn.classList.remove("active");
        });

        // Add active class to clicked button
        button.classList.add("active");

        const filter = button.getAttribute("data-filter");

        // Filter gallery items
        galleryItems.forEach(item => {
            const category = item.getAttribute("data-category");

            if (filter === "all" || filter === category) {
                item.classList.remove("hide");
            } else {
                item.classList.add("hide");
            }
        });

    });
});