export interface CalibrationPoint {
    id: string;
    ocrBbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    screenCoords: {
        x: number;
        y: number;
    };
    label?: string;
}

export interface AffineTransform {
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
}

export interface ScreenRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface CalibrationData {
    platform: string;
    points: CalibrationPoint[];
    transform: AffineTransform;
    screenWidth: number;
    screenHeight: number;
    createdAt: number;
}

export interface CalibrationEngine {
    addPoint(point: Omit<CalibrationPoint, 'id'>): void;
    computeTransform(): AffineTransform;
    applyTransform(ocrRegion: { x: number; y: number; width: number; height: number }): ScreenRegion;
    save(platform: string): Promise<void>;
    load(platform: string): Promise<CalibrationData | null>;
    clear(): void;
}

class LocalCalibrationEngine implements CalibrationEngine {
    private points: CalibrationPoint[] = [];
    private transform: AffineTransform | null = null;

    addPoint(point: Omit<CalibrationPoint, 'id'>): void {
        const id = `point_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.points.push({ ...point, id });
        this.transform = null;
    }

    removePoint(id: string): void {
        this.points = this.points.filter(p => p.id !== id);
        this.transform = null;
    }

    computeTransform(): AffineTransform {
        if (this.points.length < 3) {
            throw new Error('需要至少 3 个校准点来计算变换矩阵');
        }

        const validPoints = this.points.filter(p => 
            p.ocrBbox.width > 0 && p.ocrBbox.height > 0
        );

        if (validPoints.length < 3) {
            throw new Error('需要至少 3 个有效的校准点');
        }

        let totalScaleX = 0;
        let totalScaleY = 0;
        let totalOffsetX = 0;
        let totalOffsetY = 0;

        for (const point of validPoints) {
            const ocrCenterX = point.ocrBbox.x + point.ocrBbox.width / 2;
            const ocrCenterY = point.ocrBbox.y + point.ocrBbox.height / 2;
            
            const scaleX = point.screenCoords.x / ocrCenterX;
            const scaleY = point.screenCoords.y / ocrCenterY;
            
            totalScaleX += scaleX;
            totalScaleY += scaleY;
            totalOffsetX += point.screenCoords.x - ocrCenterX;
            totalOffsetY += point.screenCoords.y - ocrCenterY;
        }

        this.transform = {
            scaleX: totalScaleX / validPoints.length,
            scaleY: totalScaleY / validPoints.length,
            offsetX: totalOffsetX / validPoints.length,
            offsetY: totalOffsetY / validPoints.length
        };

        return this.transform;
    }

    applyTransform(ocrRegion: { x: number; y: number; width: number; height: number }): ScreenRegion {
        if (!this.transform) {
            this.computeTransform();
        }

        const t = this.transform!;
        
        return {
            x: ocrRegion.x * t.scaleX + t.offsetX,
            y: ocrRegion.y * t.scaleY + t.offsetY,
            width: ocrRegion.width * t.scaleX,
            height: ocrRegion.height * t.scaleY
        };
    }

    async save(platform: string): Promise<void> {
        if (!this.transform) {
            this.computeTransform();
        }

        const data: CalibrationData = {
            platform,
            points: this.points,
            transform: this.transform!,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            createdAt: Date.now()
        };

        localStorage.setItem(`voa_calibration_${platform}`, JSON.stringify(data));
    }

    async load(platform: string): Promise<CalibrationData | null> {
        const stored = localStorage.getItem(`voa_calibration_${platform}`);
        if (!stored) return null;

        try {
            const data: CalibrationData = JSON.parse(stored);
            
            if (data.screenWidth !== window.screen.width || 
                data.screenHeight !== window.screen.height) {
                console.warn('校准数据屏幕分辨率与当前不匹配，可能需要重新校准');
            }

            this.points = data.points;
            this.transform = data.transform;
            
            return data;
        } catch (e) {
            console.error('加载校准数据失败:', e);
            return null;
        }
    }

    clear(): void {
        this.points = [];
        this.transform = null;
    }

    getPoints(): CalibrationPoint[] {
        return [...this.points];
    }

    isReady(): boolean {
        return this.points.length >= 3 && this.transform !== null;
    }
}

export const calibrationEngine = new LocalCalibrationEngine();

export async function calibratePlatform(
    platform: string, 
    points: Omit<CalibrationPoint, 'id'>[]
): Promise<AffineTransform> {
    calibrationEngine.clear();
    
    for (const point of points) {
        calibrationEngine.addPoint(point);
    }
    
    const transform = calibrationEngine.computeTransform();
    await calibrationEngine.save(platform);
    
    return transform;
}

export async function loadCalibration(platform: string): Promise<CalibrationData | null> {
    return calibrationEngine.load(platform);
}

export function applyCalibration(
    ocrRegion: { x: number; y: number; width: number; height: number }
): ScreenRegion {
    return calibrationEngine.applyTransform(ocrRegion);
}

export function getCalibrationPoints(): CalibrationPoint[] {
    return calibrationEngine.getPoints();
}

export function isCalibrationReady(): boolean {
    return calibrationEngine.isReady();
}
