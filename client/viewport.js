export function calculateCoverViewport(windowWidth, windowHeight, canvasWidth, canvasHeight) {
    const scale = Math.max(windowWidth / canvasWidth, windowHeight / canvasHeight);
    const width = canvasWidth * scale, height = canvasHeight * scale;
    return {
        left: (windowWidth - width) / 2,
        top: (windowHeight - height) / 2,
        width, height, scale,
        visible: {
            x: (width - windowWidth) / (2 * scale),
            y: (height - windowHeight) / (2 * scale),
            w: windowWidth / scale,
            h: windowHeight / scale
        }
    };
}
