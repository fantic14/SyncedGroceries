export type Household = {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
};

export type Member = {
  user_id: string;
  display_name: string;
  role: string;
  joined_at: string;
};

export type Invite = {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  redeemed_at: string | null;
};

export type CreatedInvite = { id: string; token: string; expires_at: string };

export type HouseholdSnapshot = {
  household: Household | null;
  members: Member[];
  invites: Invite[];
};
