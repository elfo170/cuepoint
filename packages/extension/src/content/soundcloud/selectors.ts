/**
 * Seletores do DOM do SoundCloud. Quando a interface do SoundCloud mudar, ajuste apenas aqui
 * (e a fixture em test/fixtures/soundcloud-player.html).
 */
export const SELECTORS = {
  titleLink: '.playbackSoundBadge__titleLink',
  artistLink: '.playbackSoundBadge__lightLink',
  artwork: '.playbackSoundBadge .sc-artwork span, .playbackSoundBadge span.sc-artwork',
  playButton: '.playControls__play',
  playingClass: 'playing',
} as const;
