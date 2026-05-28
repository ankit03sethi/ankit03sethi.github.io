/* cursive - paid upload + Razorpay flow with wallet
 *
 * Flow:
 *   1. Customer uploads xlsx, sees cost breakdown
 *   2. Clicks "Pay now" -> Razorpay charges the total
 *   3. On payment success -> server credits wallet by paid amount, emails invoice
 *      Front-end shows new wallet balance + "Continue" button
 *   4. Click "Continue" -> server tries to append rows to master sheet
 *        on SUCCESS  -> debits wallet, button changes to "Successful"
 *        on FAILURE  -> wallet untouched, "Continue" stays clickable (retry)
 */
(function () {
  "use strict";

  // Require login
  var session;
  try { session = JSON.parse(sessionStorage.getItem("365avail.session.v1") || "null"); }
  catch (e) { session = null; }
  if (!session || !session.id || !session.password) {
    alert("Please sign in first.");
    location.replace("./");
    return;
  }

  // DOM
  var fileInput     = document.getElementById("fileInput");
  var dropZone      = document.getElementById("dropZone");
  var fileInfo      = document.getElementById("fileInfo");
  var reviewBtn     = document.getElementById("reviewBtn");
  var modalOv       = document.getElementById("payModalOverlay");
  var payRow        = document.getElementById("payRow");
  var continueRow   = document.getElementById("continueRow");
  var payNowBtn     = document.getElementById("payNowBtn");
  var cancelPayBtn  = document.getElementById("cancelPayBtn");
  var continueBtn   = document.getElementById("continueBtn");
  var closePaidBtn  = document.getElementById("closePaidBtn");
  var walletInModal = document.getElementById("walletInModal");
  var walletChipTop = document.getElementById("walletChipTop");

  // State
  var parsedRows  = null;
  var lastPayment = null;       // { paymentId, orderId, signature, amount, invoiceNumber }
  var uploadCost  = 0;           // paise/rupees of the planned upload

  // -------- Load wallet balance from server on page open --------
  function refreshWalletBalance() {
    return Trial.post("wallet_balance", {
      email: session.id,
      password: session.password
    }).then(function (res) {
      if (res && res.ok === true) {
        var b = Number(res.balance || 0);
        walletChipTop.textContent = "Wallet: ₹" + b.toFixed(2);
        walletInModal.textContent = "₹" + b.toFixed(2);
        return b;
      }
      return 0;
    }).catch(function () { return 0; });
  }
  refreshWalletBalance();

  // -------- File upload + parse --------
  function showFileInfo(rows, file) {
    parsedRows = rows;
    if (rows && rows.length) {
      fileInfo.classList.remove("hidden");
      fileInfo.innerHTML = "<strong>" + escapeHtml(file.name) + "</strong> &mdash; " + rows.length + " row" + (rows.length === 1 ? "" : "s") + " ready.";
      reviewBtn.disabled = false;
    } else {
      fileInfo.classList.add("hidden");
      reviewBtn.disabled = true;
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }

  function parseFile(file) {
    Trial.hideError("uploadError");
    var reader = new FileReader();
    reader.onload = function (ev) {
      try {
        var data = new Uint8Array(ev.target.result);
        var wb = XLSX.read(data, { type: "array" });
        var sheetName = wb.SheetNames.indexOf("Template") !== -1 ? "Template" : wb.SheetNames[0];
        var aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: "" });
        if (!aoa.length || aoa[0].length < 6) throw new Error("Template doesn't look right. Re-download it.");
        var headers = aoa[0].map(function (h) { return String(h || "").toLowerCase().trim(); });
        function findIdx(words) {
          for (var i = 0; i < headers.length; i++)
            for (var j = 0; j < words.length; j++)
              if (headers[i].indexOf(words[j]) !== -1) return i;
          return -1;
        }
        var iCountry = findIdx(["country"]);
        var iState   = findIdx(["state"]);
        var iMobile  = findIdx(["mobile"]);
        var iEmail   = findIdx(["email"]);
        var iPlat    = findIdx(["platform"]);
        var iProd    = findIdx(["product id", "productid", "product"]);
        if (iCountry < 0 || iState < 0 || iMobile < 0 || iEmail < 0 || iPlat < 0 || iProd < 0) {
          throw new Error("Some columns missing. Re-download the template.");
        }
        var rows = [];
        for (var r = 1; r < aoa.length; r++) {
          var row = aoa[r];
          if (!row || row.every(function (c) { return String(c || "").trim() === ""; })) continue;
          var country  = String(row[iCountry] || "").trim();
          var state    = String(row[iState]   || "").trim();
          var mobile   = String(row[iMobile]  || "").replace(/\D/g, "");
          var email    = String(row[iEmail]   || "").toLowerCase().trim();
          var platform = String(row[iPlat]    || "").trim();
          var product  = String(row[iProd]    || "").trim();
          if (!country || !state || !mobile || !email || !platform || !product) {
            throw new Error("Row " + (r + 1) + ": all 6 fields are required.");
          }
          rows.push({ country: country, state: state, mobile: mobile, email: email, platform: platform, productId: product });
        }
        if (!rows.length) throw new Error("The template doesn't contain any data rows.");
        showFileInfo(rows, file);
      } catch (err) {
        showFileInfo(null, file);
        fileInput.value = "";
        Trial.showError("uploadError", err.message || "Could not read the file.");
      }
    };
    reader.onerror = function () {
      showFileInfo(null, file);
      fileInput.value = "";
      Trial.showError("uploadError", "Could not read the file.");
    };
    reader.readAsArrayBuffer(file);
  }

  dropZone.addEventListener("dragover", function (e) { e.preventDefault(); dropZone.classList.add("dragover"); });
  dropZone.addEventListener("dragleave", function () { dropZone.classList.remove("dragover"); });
  dropZone.addEventListener("drop", function (e) {
    e.preventDefault(); dropZone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) parseFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", function () {
    if (fileInput.files && fileInput.files[0]) parseFile(fileInput.files[0]);
  });

  // -------- Show review modal --------
  reviewBtn.addEventListener("click", function () {
    if (!parsedRows || !parsedRows.length) return;
    var subtotal = parsedRows.length * 5;
    var gst = Math.round(subtotal * 0.18 * 100) / 100;
    var total = subtotal + gst;
    uploadCost = total;
    document.getElementById("payRows").textContent     = parsedRows.length;
    document.getElementById("paySubtotal").textContent = "₹" + subtotal.toFixed(2);
    document.getElementById("payGst").textContent      = "₹" + gst.toFixed(2);
    document.getElementById("payTotal").textContent    = "₹" + total.toFixed(2);
    Trial.hideError("modalError");
    document.getElementById("modalSuccess").classList.add("hidden");

    // Reset to step A
    payRow.classList.remove("hidden");
    continueRow.classList.add("hidden");
    Trial.busy(payNowBtn, false, "Pay now");
    Trial.busy(continueBtn, false, "Continue");
    continueBtn.disabled = false;
    continueBtn.classList.remove("btn-success");
    lastPayment = null;

    refreshWalletBalance();
    modalOv.classList.remove("hidden");
  });

  cancelPayBtn.addEventListener("click", function () {
    modalOv.classList.add("hidden");
  });

  closePaidBtn.addEventListener("click", function () {
    modalOv.classList.add("hidden");
    // Stay on page - user might want to upload again
  });

  // -------- Pay now -> Razorpay --------
  payNowBtn.addEventListener("click", function () {
    Trial.hideError("modalError");
    Trial.busy(payNowBtn, true);
    Trial.post("paid_upload_initiate", {
      email: session.id,
      password: session.password,
      rows: parsedRows,
      gstName:    document.getElementById("gstName").value.trim(),
      gstNumber:  document.getElementById("gstNumber").value.trim().toUpperCase(),
      gstAddress: document.getElementById("gstAddress").value.trim()
    }).then(function (res) {
      if (!res || res.ok !== true) {
        Trial.busy(payNowBtn, false, "Pay now");
        Trial.showError("modalError", (res && res.message) || "Could not start payment.");
        return;
      }
      openRazorpayCheckout(res);
    }).catch(function (err) {
      Trial.busy(payNowBtn, false, "Pay now");
      Trial.showError("modalError", "Server error: " + (err && err.message ? err.message : err));
    });
  });

  function openRazorpayCheckout(initData) {
    var rzp = new Razorpay({
      key: initData.razorpay.keyId,
      amount: initData.razorpay.amountPaise,
      currency: initData.razorpay.currency,
      name: "SHOPPERSKART",
      description: "cursive - " + initData.summary.rows + " product" + (initData.summary.rows === 1 ? "" : "s"),
      order_id: initData.razorpay.orderId,
      prefill: { email: session.id, contact: initData.customerMobile || "" },
      readonly: { email: true },
      theme: { color: "#1f6feb" },
      handler: function (response) {
        // Payment succeeded - credit wallet (DO NOT upload yet)
        Trial.busy(payNowBtn, true, "Pay now");
        Trial.post("wallet_credit", {
          email: session.id,
          password: session.password,
          pendingId: initData.pendingId,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_order_id:   response.razorpay_order_id,
          razorpay_signature:  response.razorpay_signature
        }).then(function (res) {
          if (!res || res.ok !== true) {
            Trial.busy(payNowBtn, false, "Pay now");
            Trial.showError("modalError", (res && res.message) || "Payment succeeded but wallet credit failed. Contact support: Contact@cursive.world");
            return;
          }
          // Payment is now sitting in wallet. Show success + Continue button.
          lastPayment = {
            paymentId:    response.razorpay_payment_id,
            orderId:      response.razorpay_order_id,
            invoiceNumber: res.invoiceNumber
          };
          var b = Number(res.balance || 0);
          walletChipTop.textContent = "Wallet: ₹" + b.toFixed(2);
          walletInModal.textContent = "₹" + b.toFixed(2);

          var ok = document.getElementById("modalSuccess");
          ok.innerHTML = "Payment received. ₹" + Number(res.amountPaid || uploadCost).toFixed(2) +
                         " added to your wallet. Invoice <strong>" + res.invoiceNumber +
                         "</strong> emailed to you.<br>Click <strong>Continue</strong> to add your products to the dashboard.";
          ok.classList.remove("hidden");

          // Swap rows: hide Pay, show Continue
          payRow.classList.add("hidden");
          continueRow.classList.remove("hidden");
        }).catch(function (err) {
          Trial.busy(payNowBtn, false, "Pay now");
          Trial.showError("modalError", "Server error: " + (err && err.message ? err.message : err));
        });
      },
      modal: {
        ondismiss: function () {
          Trial.busy(payNowBtn, false, "Pay now");
        }
      }
    });
    rzp.on('payment.failed', function (response) {
      Trial.busy(payNowBtn, false, "Pay now");
      Trial.showError("modalError", "Payment failed: " + (response.error && response.error.description ? response.error.description : "Please try again."));
    });
    rzp.open();
  }

  // -------- Continue -> try to upload, debit wallet on success --------
  continueBtn.addEventListener("click", function () {
    if (!parsedRows || !parsedRows.length) return;
    Trial.hideError("modalError");
    Trial.busy(continueBtn, true);

    Trial.post("wallet_upload", {
      email: session.id,
      password: session.password,
      rows: parsedRows,
      amount: uploadCost,
      paymentId: lastPayment ? lastPayment.paymentId : ""
    }).then(function (res) {
      if (!res || res.ok !== true) {
        // Upload failed - wallet NOT deducted, button stays clickable for retry
        Trial.busy(continueBtn, false, "Continue");
        Trial.showError("modalError", (res && res.message) || "Upload failed. Your wallet was NOT charged. Please click Continue to retry.");
        return;
      }
      // Upload succeeded - wallet has been debited server-side
      var b = Number(res.balance || 0);
      walletChipTop.textContent = "Wallet: ₹" + b.toFixed(2);
      walletInModal.textContent = "₹" + b.toFixed(2);

      // Permanent success state
      continueBtn.disabled = true;
      continueBtn.textContent = "Successful";
      continueBtn.classList.add("btn-success");

      var ok = document.getElementById("modalSuccess");
      ok.innerHTML = "<strong>Done!</strong> " + (res.rowsAdded || parsedRows.length) +
                     " product" + ((res.rowsAdded || parsedRows.length) === 1 ? "" : "s") +
                     " added to your dashboard. Taking you back...";
      ok.classList.remove("hidden");

      setTimeout(function () { location.replace("./"); }, 2500);
    }).catch(function (err) {
      // Network error - wallet NOT deducted, allow retry
      Trial.busy(continueBtn, false, "Continue");
      Trial.showError("modalError", "Server error: " + (err && err.message ? err.message : err) + " Your wallet was NOT charged. Click Continue to retry.");
    });
  });
})();
