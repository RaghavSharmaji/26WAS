# WareFlow Privacy Notice — Draft for Review

> **Not approved for commercial use.** This draft is a data inventory for review, not a legal privacy notice or compliance certification. It requires review and approval by the service operator and qualified counsel before commercial use.

## Registration information

The company registration form collects business legal and display names, business type and industry, company email/phone/address, optional website and business identifiers, initial administrator name/designation/work email/mobile number, warehouse planning estimates, preferences, and policy-acceptance timestamps and version identifiers. Account passwords are hashed using bcrypt and are not returned by APIs.

## Use and access

Registration data is used to create a pending company application, establish its initial Company Admin membership, review the application, and configure an activated workspace. Sensitive business identifiers and administrator details are exposed only from authenticated Super Admin review endpoints. The applicant status endpoint is scoped to the authenticated applicant user ID.

## Verification and storage limitations

Email verification, OTP, government identifier verification, and secure document upload/storage are not configured. A submitted email or business identifier is not verified merely because it was entered. The current form does not upload documents. Retention/deletion periods, privacy request processes, subprocessors, hosting locations, breach handling, and contact details must be established by the operator before commercial use.

## Version

Application acknowledgement currently records version `wareflow-privacy-draft-1`. This version label does not imply legal review or approval.
