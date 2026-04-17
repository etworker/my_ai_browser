import Tesseract from 'tesseract.js';

export interface OCRResult {
    text: string;
    confidence: number;
    regions: TextRegion[];
}

export interface TextRegion {
    text: string;
    bbox: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    confidence: number;
}

export interface OCREngine {
    recognize(imageData: ImageData | HTMLImageElement | HTMLCanvasElement): Promise<OCRResult>;
    recognizeBase64(base64: string): Promise<OCRResult>;
}

class TesseractOCREngine implements OCREngine {
    private worker: Tesseract.Worker | null = null;
    private isInitializing = false;

    async initialize(): Promise<void> {
        if (this.worker || this.isInitializing) return;
        
        this.isInitializing = true;
        try {
            this.worker = await Tesseract.createWorker('eng+chi_sim', 1, {
                logger: (m) => {
                    if (m.status === 'recognizing text') {
                        console.log(`OCR 进度: ${Math.round(m.progress * 100)}%`);
                    }
                }
            });
        } finally {
            this.isInitializing = false;
        }
    }

    async recognize(imageData: ImageData | HTMLImageElement | HTMLCanvasElement): Promise<OCRResult> {
        await this.initialize();
        
        if (!this.worker) {
            throw new Error('OCR worker 未初始化');
        }

        const result = await this.worker.recognize(imageData);
        
        const regions: TextRegion[] = result.data.words.map(word => ({
            text: word.text,
            bbox: {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
            },
            confidence: word.confidence
        }));

        return {
            text: result.data.text,
            confidence: result.data.confidence,
            regions
        };
    }

    async recognizeBase64(base64: string): Promise<OCRResult> {
        const imageData = await this.loadImageFromBase64(base64);
        return this.recognize(imageData);
    }

    private loadImageFromBase64(base64: string): Promise<HTMLImageElement> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = `data:image/png;base64,${base64}`;
        });
    }

    async terminate(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }
}

export const ocrEngine = new TesseractOCREngine();

export async function extractScreenText(base64Image: string): Promise<OCRResult> {
    return ocrEngine.recognizeBase64(base64Image);
}

export function findTextRegion(ocrResult: OCRResult, searchText: string): TextRegion | null {
    const normalizedSearch = searchText.toLowerCase().trim();
    
    for (const region of ocrResult.regions) {
        if (region.text.toLowerCase().includes(normalizedSearch)) {
            return region;
        }
    }
    
    return null;
}

export function findAllMatchingRegions(ocrResult: OCRResult, searchText: string): TextRegion[] {
    const normalizedSearch = searchText.toLowerCase().trim();
    
    return ocrResult.regions.filter(region => 
        region.text.toLowerCase().includes(normalizedSearch)
    );
}
