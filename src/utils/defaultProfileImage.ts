export const DEFAULT_PROFILE_IMAGES: string[] = [
  'https://happylastyear.xyz/assets/images/profile_dog_schnauzer.svg',
  'https://happylastyear.xyz/assets/images/profile_cat.svg',
  'https://happylastyear.xyz/assets/images/profile_dog_retriever.svg',
] as const;

export function pickRandomDefaultProfileImage(): string {
  const i: number = Math.floor(Math.random() * DEFAULT_PROFILE_IMAGES.length);
  return DEFAULT_PROFILE_IMAGES[i]!;
}
