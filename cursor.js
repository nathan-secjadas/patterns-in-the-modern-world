const cursor = document.querySelector(".cursor");
const colors = [
  "#f8f6eb",
  "#ffc1ea",
  "#fffdfc",
  "#c3f1ff",
  "#fba8d1",
  "#b6f0f1"
];
document.addEventListener("mousemove", (e) => {
  cursor.style.left = e.clientX + "px";
  cursor.style.top = e.clientY + "px";
  createSparkle(e.clientX, e.clientY);
});

function createSparkle(x, y) {
  // Wrapper holds the glow (filters apply after clipping only on a parent)
  const wrapper = document.createElement("div");
  wrapper.classList.add("cursor-trail");

  const star = document.createElement("div");

  const color = colors[Math.floor(Math.random() * colors.length)];
  const size = Math.random() * 8 + 4; 
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.random() * 50 + 10;

  star.style.width = "100%";
  star.style.height = "100%";
  star.style.backgroundColor = color;
  star.style.clipPath =
    "polygon(50% 0%, 61% 39%, 100% 50%, 61% 61%, 50% 100%, 39% 61%, 0% 50%, 39% 39%)";

  wrapper.style.filter = `drop-shadow(0 0 3px ${color})`;
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  wrapper.style.left = `${x}px`;
  wrapper.style.top = `${y}px`;

  wrapper.appendChild(star);
  document.body.appendChild(wrapper);

  wrapper.animate(
    [
      {
        opacity: 1,
        transform: "translate(-50%,-50%) scale(1) rotate(0deg)"
      },
      {
        opacity: 0,
        transform: `translate(calc(-50% + ${
          Math.cos(angle) * distance
        }px), calc(-50% + ${Math.sin(angle) * distance}px)) scale(0) rotate(90deg)`
      }
    ],
    {
      duration: 1000,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards"
    }
  );

  setTimeout(() => {
    wrapper.remove();
  }, 1000);
}

document.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    cursor.style.left = touch.clientX + "px";
    cursor.style.top = touch.clientY + "px";
    createSparkle(touch.clientX, touch.clientY);
  },
  { passive: false }
);