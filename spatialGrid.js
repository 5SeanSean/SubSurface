// filepath: /h:/Downloads/SUBSURFACE/spatialGrid.js
export class SpatialGrid {
    constructor(cellSize) {
        this.cellSize = cellSize;
        this.grid = new Map();
        this.objectToCells = new WeakMap();
    }
    
    clear() {
        this.grid.clear();
        this.objectToCells = new WeakMap();
    }
    
    insert(obj, x, y, width, height) {
        const cells = [];
        const startX = Math.floor(x / this.cellSize);
        const startY = Math.floor(y / this.cellSize);
        const endX = Math.floor((x + width) / this.cellSize);
        const endY = Math.floor((y + height) / this.cellSize);
        
        for (let gy = startY; gy <= endY; gy++) {
            for (let gx = startX; gx <= endX; gx++) {
                const key = this._getKey(gx, gy);
                cells.push(key);
                
                if (!this.grid.has(key)) {
                    this.grid.set(key, new Set());
                }
                this.grid.get(key).add(obj);
            }
        }
        
        this.objectToCells.set(obj, cells);
    }
    
    remove(obj) {
        const cells = this.objectToCells.get(obj);
        if (!cells) return;
        
        cells.forEach(key => {
            const cell = this.grid.get(key);
            if (cell) {
                cell.delete(obj);
                if (cell.size === 0) {
                    this.grid.delete(key);
                }
            }
        });
        
        this.objectToCells.delete(obj);
    }
    
    update(obj, x, y, width, height) {
        this.remove(obj);
        this.insert(obj, x, y, width, height);
    }
    
    getNearby(x, y, width, height) {
        const nearby = new Set();
        const startX = Math.floor(x / this.cellSize);
        const startY = Math.floor(y / this.cellSize);
        const endX = Math.floor((x + width) / this.cellSize);
        const endY = Math.floor((y + height) / this.cellSize);
        
        for (let gy = startY; gy <= endY; gy++) {
            for (let gx = startX; gx <= endX; gx++) {
                const key = this._getKey(gx, gy);
                const cell = this.grid.get(key);
                if (cell) {
                    cell.forEach(obj => nearby.add(obj));
                }
            }
        }
        
        return Array.from(nearby);
    }
    
    _getKey(x, y) {
        return (x << 16) | (y & 0xFFFF);
    }
    
    get stats() {
        let totalObjects = 0;
        this.grid.forEach(cell => totalObjects += cell.size);
        return {
            cells: this.grid.size,
            totalObjects,
            averageObjectsPerCell: this.grid.size > 0 ? totalObjects / this.grid.size : 0
        };
    }
}