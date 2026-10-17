import webpush from 'web-push';

/**
 * Makes a VAPID key pair for Web Push. Run once, put the three lines in the server `.env` and never change them
 * (a new pair disconnects every device that enabled notifications).
 */
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com');
