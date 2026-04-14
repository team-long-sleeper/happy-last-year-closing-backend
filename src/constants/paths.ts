export const EPISODES_PICTURES_PATH = '/episodes/pictures' as const;

export const episodePictureUrl = (pictureId: number) => `${EPISODES_PICTURES_PATH}/${pictureId}`;
