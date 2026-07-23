type TimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

interface TimeInterval {
  [key: string]: number;
}

/**
 * Converts a date into a human-readable relative time string
 * @param date - Date to convert (Date object, timestamp, or date string)
 * @returns A human-readable string like "5 minutes ago"
 * @throws Error if the input date is invalid
 */
export const timeAgo = (date: Date | string | number): string => {
  const parsedDate = new Date(date);
  
  // Validate the date
  if (isNaN(parsedDate.getTime())) {
    throw new Error('Invalid date provided');
  }
  
  const seconds = Math.floor((new Date().getTime() - parsedDate.getTime()) / 1000);
  
  // Define time intervals in seconds
  const intervals: TimeInterval = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
    second: 1
  };
  
  // Handle future dates
  if (seconds < 0) {
    return "in the future";
  }
  
  // Handle just now
  if (seconds < 30) {
    return "just now";
  }
  
  // Find the appropriate interval
  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    
    if (interval >= 1) {
      // Handle singular/plural
      const suffix = interval === 1 ? '' : 's';
      return `${interval} ${unit}${suffix} ago`;
    }
  }
  
  return "just now"; // Fallback return
}

export type PublicationDateStyle = 'long' | 'short';

type PublicationDateOptions = {
  style?: PublicationDateStyle;
  timeZone?: string;
};

/**
 * Formats a publication timestamp with hours and minutes.
 * Omitting timeZone uses the runtime's local timezone.
 */
export const fmtDate = (
  date: Date | string | number,
  { style = 'long', timeZone }: PublicationDateOptions = {}
): string => {
  const parsed = new Date(date);
  if (isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleString('en-US', {
    month: style,
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timeZone ? { timeZone } : {}),
  });
}
