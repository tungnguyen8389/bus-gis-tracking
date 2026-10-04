const SCREENS = ["screenLogin", "screenTrips", "screenDrive"];

// Hiện đúng một màn, ẩn các màn còn lại
export function showScreen(id) {
  SCREENS.forEach(s => { document.getElementById(s).hidden = s !== id; });
}
