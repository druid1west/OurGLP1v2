export interface User {
    id: string;
    email: string;
    first_name?: string;
    last_name?: string;
    medication_name?: string;
    medication_dose?: string;
    profile_photo?: string;
    height?: number;
    weight?: number;
    fasting_schedule?: string;
    fasting_start?: string;
    fasting_end?: string;
    bmi?: number;
    injection_day?: string;
    injection_time?: string;
}
export interface AuthContextType {
    user: User | null;
    loading: boolean;
    refreshUser: () => Promise<void>;
    logout: () => Promise<void>;
}
