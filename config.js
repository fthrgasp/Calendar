// Public values: the publishable key is designed to be shipped in the app.
// Access is enforced by the row-level-security rules in schema.sql, not by hiding this key.
window.FAMCAL_CONFIG = {
  url: 'https://aaejevsvmmhrmykozzic.supabase.co',
  key: 'sb_publishable_VkcdrcQTzFMj-kxdRlkm9w_oLDAAFc4',
  vapidPublicKey: 'BH_H2pSYZ4ztOKapewDoeeYygfoZoecnMGKzUHDXHGjXw4xazcc0v1fhqUBtXy0PVdD5SR2AipHdxHruM20BN6w', // identifies this app to push services; the matching private key lives only in Supabase secrets
};
