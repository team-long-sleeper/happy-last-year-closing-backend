const R2_PLACES_PUBLIC_URL = process.env.R2_PLACES_PUBLIC_URL!;

export const DEFAULT_PROFILE_IMAGES: string[] = [
  `${R2_PLACES_PUBLIC_URL}/profileImages/profile_dog_schnauzer.svg`,
  `${R2_PLACES_PUBLIC_URL}/profileImages/profile_cat.svg`,
  `${R2_PLACES_PUBLIC_URL}/profileImages/profile_dog_retriever.svg`,
] as const;

export function pickRandomDefaultProfileImage(): string {
  const i: number = Math.floor(Math.random() * DEFAULT_PROFILE_IMAGES.length);
  return DEFAULT_PROFILE_IMAGES[i]!;
}
