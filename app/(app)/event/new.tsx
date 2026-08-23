import { useLocalSearchParams } from 'expo-router';
import { EventForm } from '@/components/events/EventForm';

export default function NewEventScreen() {
  const params = useLocalSearchParams<{
    date?: string;
    start?: string;
    end?: string;
    allDay?: string;
    calendarId?: string;
    editId?: string;
  }>();

  if (typeof params.editId === 'string' && params.editId.length > 0) {
    return <EventForm mode="edit" eventId={params.editId} />;
  }

  return (
    <EventForm
      mode="create"
      initial={{
        date: typeof params.date === 'string' ? params.date : undefined,
        start: typeof params.start === 'string' ? params.start : undefined,
        end: typeof params.end === 'string' ? params.end : undefined,
        allDay: params.allDay === '1' || params.allDay === 'true',
        calendarId: typeof params.calendarId === 'string' ? params.calendarId : undefined,
      }}
    />
  );
}
