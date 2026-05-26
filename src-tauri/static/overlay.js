let previousGurmukhi = localStorage.getItem('gurmukhi') || '';
let intialGurmukhi = '';

const timeoutDuration = 5 * 60 * 1000;
let timeoutId;

const hideSectionAfterTimeout = () => {
    const containerEl = document.getElementById('container');
    containerEl.style.display = 'none'; // Hide the section
};

function hexToRgba(hex, opacity) {
  // Remove the '#' symbol if it exists
  hex = hex.replace('#', '');

  // Parse the hex color into its RGB components
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Return the rgba string
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

const fetchData = async () => {
    const res = await fetch('/api/custom_data');
    const data = await res.json();

    const containerEl = document.getElementById('container');

    if (data.gurmukhi != intialGurmukhi) {
        const gurmukhiEl = document.getElementById('gurmukhi');
        const punjabiEl = document.getElementById('punjabi');
        const englishEl = document.getElementById('english');

        gurmukhiEl.textContent = data.gurmukhi;
        punjabiEl.textContent = data.punjabi;
        englishEl.textContent = data.english;

        gurmukhiEl.style.fontFamily = data.font;

        containerEl.style.paddingTop = data.panel_gap_x + 'px';
        containerEl.style.paddingRight = data.panel_gap_y + 'px';
        containerEl.style.paddingBottom = data.panel_gap_x + 'px';
        containerEl.style.paddingLeft = data.panel_gap_y + 'px';

        punjabiEl.style.marginTop = data.punjabi_gap + 'px';
        englishEl.style.marginTop = data.english_gap + 'px';

        gurmukhiEl.style.fontSize = data.gurmukhi_font_size + 'px';
        punjabiEl.style.fontSize = data.punjabi_font_size + 'px';
        englishEl.style.fontSize = data.english_font_size + 'px';

        gurmukhiEl.style.color = data.gurmukhi_font_color;
        punjabiEl.style.color = data.punjabi_font_color;
        englishEl.style.color = data.english_font_color;

        let rgbaColor = hexToRgba(data.background_color, data.background_opacity);
        containerEl.style.backgroundColor = `${rgbaColor}`;
        document.body.style.fontSize = data.font_size + 'px';

        fitTextToOneLineWithEllipsis(punjabiEl, data.punjabi_font_size);
        fitTextToOneLineWithEllipsis(englishEl, data.english_font_size);
    }

    // Compare the new data with the previous data
    if (
        data.gurmukhi != previousGurmukhi
    ) {
        containerEl.style.display = 'inline-flex';

        // Update previous data with the current data
        previousGurmukhi = data.gurmukhi;

        localStorage.setItem('gurmukhi', data.gurmukhi);
        localStorage.setItem('lastUpdate', Date.now().toString());

        clearTimeout(timeoutId);
        timeoutId = setTimeout(hideSectionAfterTimeout, timeoutDuration);
    }

    setTimeout(fetchData, 1000);
};

const checkInactivityTimeout = () => {
    const lastUpdate = parseInt(localStorage.getItem('lastUpdate'), 10);
    if (lastUpdate) {
        const timeElapsed = Date.now() - lastUpdate;
        if (timeElapsed > timeoutDuration) {
            hideSectionAfterTimeout(); // Hide section if 5 minutes passed
        } else {
            const remainingTime = timeoutDuration - timeElapsed;
            timeoutId = setTimeout(hideSectionAfterTimeout, remainingTime);
        }
    }
};

function fitTextToOneLineWithEllipsis(element, maxFontSizePx) {
    const parentElement = element.parentElement;
    
    // Get the available width of the parent
    const parentWidth = parentElement.clientWidth;
    let fontSize = maxFontSizePx;
    let fontChange = false;

    // Set initial styles for ellipsis and overflow handling
    element.style.whiteSpace = 'nowrap';  // Ensure text stays on one line
    element.style.overflow = 'hidden';    // Hide any overflowing text
    element.style.textOverflow = 'ellipsis'; // Add ellipsis if text overflows
    element.style.fontSize = fontSize + 'px';
    element.style.width = '100%';
}

document.addEventListener('DOMContentLoaded', () => {
    checkInactivityTimeout();
    fetchData();
});