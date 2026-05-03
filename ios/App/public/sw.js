self.addEventListener('push', function (event) {
  const data = event.data?.json() || {};
  const title = data.title || 'Reminder';
  const options = {
    body: data.body || 'You have a new reminder!',
    icon: '/icon.png',
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});