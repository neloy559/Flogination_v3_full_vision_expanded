# Data Ingestion Schema: Session Cookies & Beyond

This list defines every data point the system will capture, store, and track for each imported account.

## 1. Primary Identity & Access
*   **UID (c_user)**: The unique Facebook numerical identifier.
*   **FB Name**: Full name as it appears on the profile.
*   **Profile URL**: Direct link to the account.
*   **Password**: For manual login or recovery.
*   **Cookie (Full Set)**: Raw JSON or string format containing `xs`, `datr`, `sb`, `fr`, etc.
*   **2FA Secret Key**: Used by our internal **Auto-TOTP** generator to bypass security checks.

## 2. Personal Account Metadata
*   **Country**: Geo-location of the account.
*   **Phone Number**: Linked phone (if available).
*   **Email**: Primary linked email.
*   **Date of Birth**: Captured for recovery or birthday interactions.
*   **Gender**: To personalize "Social Farm" interactions.
*   **Creation Date**: To track account age and trust level.

## 3. Asset & Infrastructure Status
*   **BM Status (Business Manager)**:
    *   BM Count.
    *   BM Roles (Admin/Editor).
    *   BM Restriction status (Live/Restricted).
*   **Page Status**:
    *   Owned Pages (Names/IDs).
    *   Pages Following count.
*   **Group Status**:
    *   Groups joined count.
    *   Moderator/Admin roles in specific groups.

## 4. Ad Account Intelligence (MetaMax Standard)
*   **ID ADS**: Personal or Business Ad Account ID.
*   **Currency & Timezone**: Financial settings.
*   **Spending Limit**: Total daily/overall spending capacity.
*   **Current Threshold**: The amount FB lets you spend before billing.
*   **Account Balance**: Current unpaid balance.
*   **Total Spent**: Historical spend on the account.
*   **Billing Date**: Next scheduled payment date.
*   **PTTT (Payment Method)**: Type of card or payment method linked (CC/PayPal/etc.).

## 5. Social & Health Metrics
*   **Friends Count**: Total friends for social trust scoring.
*   **Health Status**: Real-time status (Live, Checkpoint 282, Restricted, Dead).
*   **Proxy ID**: The specific residential HTTP proxy linked to this session.
*   **Last Check**: Timestamp of the last resource check.
