interface Reservation {
  id: string;
  group_id: string;
  facility_id: string;
  start_at: string;
  end_at: string;
  headcount: number;
  note: string;
  status: 'provisional' | 'approved' | 'withdrawn' | 'rejected' | 'cancelled' | 'cancelled_by_staff';
  status_reason: string;
  created_by: string;
}
