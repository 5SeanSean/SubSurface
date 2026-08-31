// filepath: /h:/Downloads/SUBSURFACE/objectPool.js
export class ObjectPool {
    constructor(createFn, resetFn, initialSize = 50) {
        this.createFn = createFn;
        this.resetFn = resetFn;
        this.pool = [];
        this.active = new Set();
        
        for (let i = 0; i < initialSize; i++) {
            this.pool.push(createFn());
        }
    }
    
    acquire() {
        let obj;
        if (this.pool.length > 0) {
            obj = this.pool.pop();
        } else {
            obj = this.createFn();
        }
        this.active.add(obj);
        this.resetFn(obj);
        return obj;
    }
    
    release(obj) {
        this.active.delete(obj);
        this.pool.push(obj);
    }
    
    releaseAll() {
        this.active.forEach(obj => this.release(obj));
    }
    
    get activeCount() {
        return this.active.size;
    }
    
    get poolSize() {
        return this.pool.length;
    }
}

// Pre-configured pools
export const pools = {
    splashes: null,
    particles: null,
    projectiles: null
};

export function initializePools() {
    pools.splashes = new ObjectPool(
        () => ({ particles: [], x: 0, y: 0, radius: 0, color: '', shape: 'circle' }),
        (obj) => {
            obj.particles.length = 0;
            obj.x = obj.y = obj.radius = 0;
            obj.color = '';
            obj.shape = 'circle';
        },
        50
    );
    
    pools.particles = new ObjectPool(
        () => ({ x: 0, y: 0, radius: 0, dy: 0, xPhysics: 0, yPhysics: 0, opacity: 1, color: '' }),
        (obj) => {
            obj.x = obj.y = obj.radius = obj.dy = obj.xPhysics = obj.yPhysics = 0;
            obj.opacity = 1;
            obj.color = '';
        },
        200
    );
}