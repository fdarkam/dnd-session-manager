export const formatDate = (dateString) => {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Pacific/Noumea',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(dateString));
};
