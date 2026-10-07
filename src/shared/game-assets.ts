export const CARD_IMAGE_SIZES = ['thumb', 'medium', 'large'] as const;
export type CardImageSize = (typeof CARD_IMAGE_SIZES)[number];

export interface CardImageCatalogItem {
  readonly cardCode: string;
  readonly cardType: 'MEMBER' | 'LIVE' | 'ENERGY';
  readonly name: string;
  readonly cost: number | null;
  readonly score: number | null;
  readonly cardStatus: 'DRAFT' | 'PUBLISHED';
  readonly imageFilename: string | null;
  readonly baseName: string | null;
  readonly usesCardCodeFallback: boolean;
  readonly version: 'VERSIONED' | 'UNVERSIONED' | 'INVALID';
  readonly warning: string | null;
  readonly updatedAt: string;
  readonly urls: Readonly<Record<CardImageSize, string | null>>;
}

export interface CardImageCatalogFilters {
  readonly page: number;
  readonly pageSize: number;
  readonly query?: string;
  readonly cardType?: CardImageCatalogItem['cardType'];
  readonly cardStatus?: CardImageCatalogItem['cardStatus'];
  readonly filename?: 'SET' | 'UNSET';
}

export interface CardImageCatalogPage {
  readonly items: readonly CardImageCatalogItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
}

export interface CardImageObjectCheck {
  readonly size: CardImageSize;
  readonly objectKey: string | null;
  readonly url: string | null;
  readonly status: 'AVAILABLE' | 'MISSING' | 'ERROR';
  readonly bytes: number | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly sha256: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly contentVerified: boolean;
  readonly message: string | null;
}

export interface CardImageCatalogDetail {
  readonly card: CardImageCatalogItem;
  readonly references: readonly CardImageCatalogItem[];
  readonly objects: readonly CardImageObjectCheck[];
  readonly checkedAt: string;
}

export interface CardImageInventory {
  readonly schemaVersion: 1;
  readonly checkedAt: string;
  readonly verifyContent: boolean;
  readonly cards: readonly CardImageCatalogItem[];
  readonly objects: readonly (CardImageObjectCheck & { readonly cardCodes: readonly string[] })[];
  readonly summary: {
    readonly cards: number;
    readonly objects: number;
    readonly available: number;
    readonly missing: number;
    readonly errors: number;
    readonly verified: number;
    readonly invalidCards: number;
  };
}
