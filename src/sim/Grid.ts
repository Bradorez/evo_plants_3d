/**
 * Grid is a thin utility around the regular 2D simulation lattice.
 * Centralising index math keeps all hydrology code operating on fast typed
 * arrays while avoiding scattered coordinate conversions throughout the app.
 */
export class Grid {
  public readonly width: number;
  public readonly height: number;
  public readonly cellCount: number;

  public constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cellCount = width * height;
  }

  public index(x: number, y: number): number {
    return y * this.width + x;
  }

  public isInside(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }
}
